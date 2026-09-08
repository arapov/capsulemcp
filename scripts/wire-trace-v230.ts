/**
 * Wire-trace for v2.3.0 — invoke the REAL tool code for every surface
 * this release adds or changes, intercept the HTTP requests it emits,
 * and assert the wire shapes match what was probed live on 2026-08-16
 * (issue #112, PRs #113–#116):
 *
 *   1. per-resource embeds on the wire, incl. the project→kase token
 *      mapping and the party sub-list forwarding (audit blocker fix)
 *   2. tracks-at-create (`trackDefinitionIds` → tracks:[{definition:{id}}])
 *   3. opportunity duration/durationBasis
 *   4. task repeat
 *   5. add_note activityTypeId (bare int on the wire)
 *   6. upload_attachment entryId mode + update_entry removeAttachmentIds
 *   7. `since` on list endpoints
 *   8. the three new read tools (list_activities / countries / currencies)
 *
 * Run with:
 *   CAPSULE_API_TOKEN=<write-scoped> npx tsx scripts/wire-trace-v230.ts
 *
 * Makes REAL Capsule API calls. Records are created with
 * ZZZ-MCP-WT230-* names and deleted in a finally block; if the script
 * crashes, search Capsule for 'ZZZ-MCP-WT230' and clean up manually.
 *
 * Assertion strategy: request URLs/methods are asserted from the
 * undici diagnostics channel; request BODIES are not (undici ≥8.10.2
 * exposes them only as an opaque stream there). Exact body shapes are
 * pinned by unit tests against a mocked fetch (tests/p3-write-gaps,
 * tests/embeds); what only a live run can prove — Capsule ACCEPTING
 * each shape and the intended effect holding — is what this asserts.
 */

import { subscribe } from "node:diagnostics_channel";

interface UndiciRequest {
  method: string;
  path: string;
  body?: string | Buffer | unknown;
}

const calls: Array<{ method: string; path: string; body?: string }> = [];

subscribe("undici:request:create", (message: unknown) => {
  const r = (message as { request?: UndiciRequest }).request;
  if (!r) return;
  let bodyPreview: string | undefined;
  if (typeof r.body === "string") bodyPreview = r.body;
  else if (Buffer.isBuffer(r.body)) bodyPreview = `<Buffer ${r.body.length} bytes>`;
  else if (r.body) bodyPreview = "<non-string body>";
  calls.push({ method: r.method, path: r.path, body: bodyPreview });
});

function lastCall(offsetFromEnd = 0) {
  const c = calls[calls.length - 1 - offsetFromEnd];
  if (!c) throw new Error("no call captured");
  return c;
}

let checks = 0;
function assertWire(label: string, cond: boolean, detail: string) {
  checks++;
  if (!cond) {
    const c = calls[calls.length - 1];
    throw new Error(
      `✗ [${label}] ${detail}\n  last call: ${c?.method} ${c?.path}\n  body: ${c?.body ?? "(none)"}`,
    );
  }
  console.log(`  ✓ ${label} — ${detail}`);
}

async function main() {
  if (!process.env["CAPSULE_API_TOKEN"]) {
    console.error("CAPSULE_API_TOKEN not set");
    process.exit(1);
  }

  const { createParty, searchParties, listPartyProjects } = await import("../src/tools/parties.js");
  const { createOpportunity } = await import("../src/tools/opportunities.js");
  const { createProject, getProject } = await import("../src/tools/projects.js");
  const { createTask, listTasks } = await import("../src/tools/tasks.js");
  const { addNote, updateEntry } = await import("../src/tools/entries.js");
  const { uploadAttachment } = await import("../src/tools/attachments.js");
  const { listActivityTypes, listTrackDefinitions, listCountries, listCurrencies } = await import(
    "../src/tools/metadata.js"
  );
  const { listActivities } = await import("../src/tools/activities.js");
  const { listEntityTracks } = await import("../src/tools/tracks.js");
  const { capsuleGet } = await import("../src/capsule/client.js");

  console.log("========== WIRE TRACE v2.3.0 — invoking real TS code ==========\n");

  let partyId: number | undefined;
  let projectId: number | undefined;
  let oppId: number | undefined;
  let taskId: number | undefined;
  let noteId: number | undefined;

  try {
    // ── setup: a party to hang everything off ────────────────────────────────
    const party = (await createParty({
      type: "organisation",
      name: "ZZZ-MCP-WT230-ORG",
      about: "v2.3.0 wire-trace probe — will be deleted",
    })) as { party: { id: number } };
    partyId = party.party.id;

    // ── 1. tracks-at-create (project — tenant defs are all project-scoped) ──
    console.log("== tracks-at-create ==");
    const defs = (await listTrackDefinitions({ page: 1, perPage: 100 })) as {
      trackDefinitions: Array<{ id: number; description?: string; captureRule?: string }>;
    };
    const projectDef =
      defs.trackDefinitions.find((d) => /case|project/i.test(String(d.captureRule ?? ""))) ??
      defs.trackDefinitions[0];
    if (!projectDef) throw new Error("tenant has no track definitions — cannot probe");

    const proj = (await createProject({
      name: "ZZZ-MCP-WT230-PROJ",
      partyId,
      trackDefinitionIds: [projectDef.id],
    })) as { project: { id: number } };
    projectId = proj.project.id;
    const applied = (await listEntityTracks({ entity: "projects", entityId: projectId })) as {
      tracks: Array<{ id: number; description?: string }>;
    };
    // Track instances don't carry a definition ref — match on the
    // description Capsule copies over from the definition.
    assertWire(
      "tracks-at-create",
      applied.tracks.some((t) => t.description === projectDef.description),
      `create_project with trackDefinitionIds actually applied track def ${projectDef.id}`,
    );

    // ── 2. embeds ───────────────────────────────────────────────────────────
    console.log("\n== embeds ==");
    const got = (await getProject({ id: projectId, embed: "party,opportunity" })) as {
      project: { party?: Record<string, unknown> };
    };
    assertWire(
      "embed URL",
      lastCall().path.includes("embed=party%2Copportunity"),
      "get_project forwards embed=party,opportunity",
    );
    assertWire(
      "embed enrichment",
      Object.keys(got.project.party ?? {}).length > 4,
      `nested party ref enriched (${Object.keys(got.project.party ?? {}).length} keys > 4)`,
    );

    await listPartyProjects({ partyId, embed: "opportunity", page: 1, perPage: 25 });
    assertWire(
      "party sub-list embed (audit blocker)",
      lastCall().path.includes(`/parties/${partyId}/kases`) &&
        lastCall().path.includes("embed=opportunity"),
      "list_party_projects forwards embed on the wire",
    );

    await listTasks({ embed: "project,owner", page: 1, perPage: 1 });
    assertWire(
      "project→kase token",
      lastCall().path.includes("embed=kase%2Cowner"),
      "caller says project, wire says kase",
    );

    // ── 3. opportunity duration ─────────────────────────────────────────────
    console.log("\n== opportunity duration ==");
    const pipelines = (await capsuleGet<{ pipelines: { id: number }[] }>("/pipelines")) as {
      data: { pipelines: { id: number }[] };
    };
    const milestones = (await capsuleGet<{ milestones: { id: number }[] }>(
      `/pipelines/${pipelines.data.pipelines[0]!.id}/milestones`,
    )) as { data: { milestones: { id: number }[] } };

    const opp = (await createOpportunity({
      name: "ZZZ-MCP-WT230-DEAL",
      partyId,
      milestoneId: milestones.data.milestones[0]!.id,
      durationBasis: "MONTH",
      duration: 12,
    })) as { opportunity: { id: number; duration?: number | null; durationBasis?: string } };
    oppId = opp.opportunity.id;
    assertWire(
      "duration echo",
      opp.opportunity.duration === 12 && opp.opportunity.durationBasis === "MONTH",
      "Capsule accepted and echoed duration/durationBasis",
    );

    // ── 4. task repeat ──────────────────────────────────────────────────────
    console.log("\n== task repeat ==");
    const task = (await createTask({
      description: "ZZZ-MCP-WT230-TASK",
      dueOn: "2026-12-31",
      partyId,
      repeat: { frequency: "WEEKLY", interval: 2 },
    })) as { task: { id: number } };
    taskId = task.task.id;
    assertWire(
      "repeat echo",
      JSON.stringify(task.task).includes('"WEEKLY"'),
      "Capsule accepted the repeat object and echoed the recurrence",
    );

    // ── 5. add_note activityTypeId ──────────────────────────────────────────
    console.log("\n== add_note activityTypeId ==");
    const types = (await listActivityTypes({ page: 1, perPage: 100 })) as {
      activityTypes: Array<{ id: number; name: string }>;
    };
    const noteType = types.activityTypes[0];
    if (!noteType) throw new Error("tenant has no activity types — cannot probe");

    const note = (await addNote({
      content: "ZZZ-MCP-WT230 probe note",
      partyId,
      activityTypeId: noteType.id,
    })) as { entry: { id: number; activityType?: { id?: number } } };
    noteId = note.entry.id;
    assertWire(
      "activityType echo",
      note.entry.activityType?.id === noteType.id,
      `Capsule accepted the bare-int activityType and echoed type ${noteType.id} ('${noteType.name}')`,
    );

    // ── 6. attachment entryId mode + removeAttachmentIds ────────────────────
    console.log("\n== attachment deltas ==");
    const att = (await uploadAttachment({
      filename: "wt230-probe.txt",
      contentType: "text/plain",
      dataBase64: Buffer.from("v2.3.0 wire-trace attachment").toString("base64"),
      entryId: noteId,
    })) as { entry: { attachments?: Array<{ id: number }> } };
    assertWire(
      "entryId-mode PUT",
      lastCall().method === "PUT" && lastCall().path.includes(`/entries/${noteId}`),
      "upload step then PUT to the existing entry — no new note created",
    );
    const attachmentId = att.entry.attachments?.[0]?.id;
    if (!attachmentId) throw new Error("no attachment id returned from entryId-mode upload");
    assertWire(
      "entryId-mode effect",
      (att.entry.attachments ?? []).length === 1,
      `attachment ${attachmentId} landed on the existing entry`,
    );

    const stripped = (await updateEntry({ id: noteId, removeAttachmentIds: [attachmentId] })) as {
      entry: { attachments?: Array<{ id: number }> };
    };
    assertWire(
      "removeAttachmentIds effect",
      (stripped.entry.attachments ?? []).length === 0,
      "attachment actually removed from the entry",
    );

    // ── 7. since ────────────────────────────────────────────────────────────
    console.log("\n== since ==");
    await searchParties({ since: "2026-01-01T00:00:00Z", page: 1, perPage: 1 });
    assertWire(
      "since wire",
      lastCall().path.includes("since=2026-01-01"),
      "search_parties forwards since on the list path",
    );

    // ── 8. new read tools ───────────────────────────────────────────────────
    console.log("\n== new read tools ==");
    const acts = (await listActivities({ page: 1, perPage: 2 })) as { activities: unknown[] };
    assertWire(
      "list_activities",
      lastCall().path.includes("/activities") && Array.isArray(acts.activities),
      `GET /activities returns rows (${acts.activities.length})`,
    );
    assertWire(
      "list_activities normalization",
      !JSON.stringify(acts.activities).includes('"kase"'),
      "kase→project normalization applied to activity rows",
    );

    const countries = (await listCountries()) as { countries: unknown[] };
    assertWire(
      "list_countries",
      countries.countries.length > 200,
      `GET /countries returns the dictionary (${countries.countries.length} rows)`,
    );

    const currencies = (await listCurrencies()) as { currencies: unknown[] };
    assertWire(
      "list_currencies",
      currencies.currencies.length > 50,
      `GET /currencies returns the dictionary (${currencies.currencies.length} rows)`,
    );

    console.log(`\n✓ wire-trace v2.3.0 complete — ${checks} checks passed against the live API.`);
  } finally {
    console.log("\n== cleanup ==");
    const { deleteEntry: delEntry } = await import("../src/tools/entries.js");
    const { deleteTask: delTask } = await import("../src/tools/tasks.js");
    const { deleteOpportunity: delOpp } = await import("../src/tools/opportunities.js");
    const { deleteProject: delProj } = await import("../src/tools/projects.js");
    const { deleteParty: delParty } = await import("../src/tools/parties.js");
    const attempt = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        console.log(`  deleted ${label}`);
      } catch (err) {
        console.error(`  FAILED to delete ${label}: ${(err as Error).message}`);
      }
    };
    if (noteId !== undefined)
      await attempt("note entry", () => delEntry({ id: noteId!, confirm: true }));
    if (taskId !== undefined) await attempt("task", () => delTask({ id: taskId!, confirm: true }));
    if (oppId !== undefined)
      await attempt("opportunity", () => delOpp({ id: oppId!, confirm: true }));
    if (projectId !== undefined)
      await attempt("project", () => delProj({ id: projectId!, confirm: true }));
    if (partyId !== undefined)
      await attempt("party", () => delParty({ id: partyId!, confirm: true }));
  }
}

main().catch((err) => {
  console.error("\n✗ wire-trace v2.3.0 failed:", err);
  console.error("\nSearch Capsule for 'ZZZ-MCP-WT230' if cleanup did not complete.");
  process.exit(1);
});
