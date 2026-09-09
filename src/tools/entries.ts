import { z } from "zod";
import { positiveId, paginationFields, embedParam, ENTRY_EMBEDS } from "./shared-schemas.js";
import { assertSingleParentRef, setRef } from "./body-helpers.js";
import { defineDelete } from "./define-delete.js";
import { capsuleGet, capsulePost, capsulePut, capsuleGetList } from "../capsule/client.js";
import { getBatchConcurrency, mapWithConcurrency } from "../capsule/batch.js";

// ── Read ────────────────────────────────────────────────────────────────────

const listEntriesPagination = {
  ...paginationFields,
  embed: embedParam(ENTRY_EMBEDS),
};

export const listPartyEntriesSchema = z.object({
  partyId: positiveId,
  ...listEntriesPagination,
  includeLinkedPersons: z
    .boolean()
    .optional()
    .describe(
      "When true AND `partyId` is an ORGANISATION, also include entries filed against the organisation's linked people (the persons whose `organisation` field references this org). The connector enumerates linked persons via `GET /parties/{orgId}/people`, fans out `GET /parties/{personId}/entries` in parallel (concurrency-capped, default 5 / configurable via `CAPSULE_MCP_BATCH_CONCURRENCY`), and merges into a single feed sorted by `entryAt` descending, deduped by entry id. " +
        "Default is `false` — single GET, existing behaviour unchanged. " +
        "WHY THIS FLAG EXISTS: Capsule's API files each entry against exactly one party, opportunity, or project row (verified v1.6.6 wire-trace probe 4 — POST /entries rejects multi-party bodies with 422). For an organisation with multiple contacts, captured emails almost always land on a person row, not the org. As a result, `list_party_entries(orgId)` with `includeLinkedPersons: false` will miss recent customer-facing email — even though the org's own `lastContactedAt` is updated by the activity. This flag is the correct call for any 'what's new with $ORG?' question. " +
        "WHEN `partyId` IS A PERSON: silently no-op — persons have no linked-people relationship in Capsule's data model, so the flag is functionally inert (the connector still issues a cheap `/people` check; the response is empty). " +
        "LATENCY: 1 + N round trips for an org with N linked people, concurrency-capped (typical: 2-3 waves for N=10). Linked-person enumeration reads the first 100 linked people; use list_employees for explicit pagination when an organisation has more contacts than that. Use `includeLinkedPersons: false` for fast pre-screen reads where you only need the org-row entries (e.g. invoice/contract notes that are typically filed at the org level). " +
        "PAGINATION CAVEAT: `page` and `perPage` apply to the MERGED window, and the merge has a hard ceiling — it reliably orders only the most-recent ~100 entries across the org + its people (each party is fetched at Capsule's per-party cap of 100, and a top-100-per-party merge is correct only up to global position 100). Windows that cross the ceiling are truncated to the entries still inside that top-100 set; windows starting beyond it return no entries and end the feed. It does NOT continue into older history. To read a specific contact's full timeline beyond the merged ceiling, call `list_party_entries` on that person's id directly (the default single-GET path paginates natively with no ceiling). For the LLM-driven 'what's the latest with $ORG' query this is the typical use of, the first page is exact and the ceiling is never reached.",
    ),
});

interface PartyEntriesPage {
  entries: unknown[];
  nextPage: number | undefined;
}

/**
 * Capsule's per-request `perPage` ceiling — the most entries one
 * `GET /parties/:id/entries` call can return, and therefore the
 * per-party candidate cap the merged-timeline math is built around
 * (see `mergedTimelineNextPage` for why the merge is only reliable up
 * to this global position).
 */
const PER_PARTY_FETCH_CAP = 100;

/**
 * Fetch `entries` arrays for multiple party ids in parallel,
 * concurrency-capped by `getBatchConcurrency()`. Rejects on the first
 * failure (mapWithConcurrency propagates) — read-path orchestration is
 * correctness-strict: a partial timeline is worse than a clean error.
 */
async function fanOutPartyEntries(
  partyIds: number[],
  embed: string | undefined,
  perPage: number,
): Promise<PartyEntriesPage[]> {
  return mapWithConcurrency(partyIds, getBatchConcurrency(), async (id) => {
    const { data, nextPage } = await capsuleGet<{ entries: unknown[] }>(`/parties/${id}/entries`, {
      embed,
      page: 1,
      perPage,
    });
    return { entries: data.entries, nextPage };
  });
}

function mergedTimelineCandidatePerParty(page: number, perPage: number): number {
  return Math.min(page * perPage, PER_PARTY_FETCH_CAP);
}

function mergedTimelineNextPage(
  page: number,
  perPage: number,
  mergedLength: number,
  upstreamHasNextPage: boolean,
): number | undefined {
  const requestedWindowEnd = page * perPage;
  // Hard ceiling, checked FIRST: each party contributes at most its
  // top-100 entries, so the merge reliably orders only the global
  // top ~100. With two populated feeds the candidate array can hold
  // up to 200 rows whose order past position 100 is NOT guaranteed —
  // the mergedLength check below must never promise a page out there.
  if (requestedWindowEnd >= PER_PARTY_FETCH_CAP) return undefined;
  if (mergedLength > requestedWindowEnd) return page + 1;

  // Inside the guaranteed top-100 window, an upstream Link rel=next
  // means there are older entries beyond our candidate set even though
  // the merged slice was exactly full — preserve that signal instead
  // of falsely ending the feed (the v1.6.6 regression this guards).
  if (upstreamHasNextPage) return page + 1;

  return undefined;
}

export async function listPartyEntries(input: z.infer<typeof listPartyEntriesSchema>) {
  const { partyId, embed, page, perPage, includeLinkedPersons } = input;

  // Fast path: default behaviour, single GET — preserves the
  // pre-v1.6.6 contract bit-for-bit.
  if (!includeLinkedPersons) {
    return capsuleGetList<{ entries: unknown[] }>(`/parties/${partyId}/entries`, {
      embed,
      page,
      perPage,
    });
  }

  // Enumerate linked persons. perPage capped at 100 (Capsule's max);
  // tenants with >100 linked persons on a single org see partial
  // coverage. The schema description calls this out and points to
  // list_employees for explicit linked-person pagination.
  const { data: peopleData } = await capsuleGet<{ parties?: { id: number }[] }>(
    `/parties/${partyId}/people`,
    { page: 1, perPage: PER_PARTY_FETCH_CAP },
  );
  const peopleIds = (peopleData.parties ?? []).map((p) => p.id);

  // Person partyId no-op + org-with-no-linked-people short-circuit.
  // Both collapse to the single-GET fast path: no fan-out needed.
  if (peopleIds.length === 0) {
    return capsuleGetList<{ entries: unknown[] }>(`/parties/${partyId}/entries`, {
      embed,
      page,
      perPage,
    });
  }

  // Fan out: org's own entries + each linked person's entries.
  // Fetch enough from each party to cover the requested merged window
  // when possible (Capsule caps perPage at 100).
  const targetIds = [partyId, ...peopleIds];
  const perPartyPages = await fanOutPartyEntries(
    targetIds,
    embed,
    mergedTimelineCandidatePerParty(page, perPage),
  );

  // Merge with dedup. Capsule's API files each entry against exactly
  // one party (v1.6.6 wire-trace probe 4 — POST rejects multi-party),
  // so naive concat is correctness-safe; the `Set<id>` dedup is
  // defensive against captured-email SMTP routing rules we can't
  // simulate in the probe and against any future API change.
  const seen = new Set<number>();
  const merged: Array<{ id: number; entryAt?: string }> = [];
  for (const { entries } of perPartyPages) {
    for (const raw of entries) {
      const e = raw as { id: number; entryAt?: string };
      if (typeof e?.id !== "number") continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      merged.push(e);
    }
  }

  // Sort newest-first (matches Capsule's default order on
  // /parties/:id/entries). Fall back to id ordering when entryAt is
  // absent so the sort is total.
  merged.sort((a, b) => {
    const ax = a.entryAt ?? "";
    const bx = b.entryAt ?? "";
    if (ax !== bx) return bx.localeCompare(ax);
    return b.id - a.id;
  });

  // Apply caller's pagination window over the merged feed, truncated
  // at the ceiling: positions past PER_PARTY_FETCH_CAP may be missing
  // newer entries from a busier party, so they are never served.
  const start = (page - 1) * perPage;
  const slice = merged.slice(start, Math.min(start + perPage, PER_PARTY_FETCH_CAP));
  const nextPage = mergedTimelineNextPage(
    page,
    perPage,
    merged.length,
    perPartyPages.some((p) => p.nextPage !== undefined),
  );

  return { entries: slice, ...(nextPage !== undefined ? { nextPage } : {}) };
}

export const listOpportunityEntriesSchema = z.object({
  opportunityId: positiveId,
  ...listEntriesPagination,
});

export async function listOpportunityEntries(input: z.infer<typeof listOpportunityEntriesSchema>) {
  return capsuleGetList<{ entries: unknown[] }>(`/opportunities/${input.opportunityId}/entries`, {
    embed: input.embed,
    page: input.page,
    perPage: input.perPage,
  });
}

export const listProjectEntriesSchema = z.object({
  projectId: positiveId,
  ...listEntriesPagination,
});

export async function listProjectEntries(input: z.infer<typeof listProjectEntriesSchema>) {
  return capsuleGetList<{ entries: unknown[] }>(`/kases/${input.projectId}/entries`, {
    embed: input.embed,
    page: input.page,
    perPage: input.perPage,
  });
}

export const getEntrySchema = z.object({
  id: positiveId,
  embed: embedParam(ENTRY_EMBEDS),
});

export async function getEntry(input: z.infer<typeof getEntrySchema>) {
  const { data } = await capsuleGet<{ entry: unknown }>(`/entries/${input.id}`, {
    embed: input.embed,
  });
  return data;
}

// ── Global entries feed ─────────────────────────────────────────────────────
//
// GET /entries returns every timeline entry in the account, paginated.
// Useful for "what activity happened across the company today/this week"
// without iterating over every party/opportunity/project. Default order
// is most-recent-first (Capsule's default for /entries specifically).

export const listEntriesSchema = z.object({
  ...listEntriesPagination,
});

export async function listEntries(input: z.infer<typeof listEntriesSchema>) {
  return capsuleGetList<{ entries: unknown[] }>("/entries", {
    embed: input.embed,
    page: input.page,
    perPage: input.perPage,
  });
}

// ── Write ───────────────────────────────────────────────────────────────────

// MCP SDK needs a plain ZodObject shape; enforce the exactly-one constraint in the handler.
export const addNoteSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Note body text. Stored verbatim and treated as MARKDOWN — Capsule's web UI renders the markdown when displaying. Pass markdown source ('# Heading', '**bold**', '- bullet'), not HTML.",
    ),
  partyId: positiveId
    .optional()
    .describe("Link note to a party (mutually exclusive with opportunityId/projectId)"),
  opportunityId: positiveId
    .optional()
    .describe("Link note to an opportunity (mutually exclusive with partyId/projectId)"),
  projectId: positiveId
    .optional()
    .describe("Link note to a project (mutually exclusive with partyId/opportunityId)"),
  entryAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/)
    .optional()
    .describe(
      "ISO-8601 timestamp for when this note actually happened (e.g. '2024-03-15T14:30:00Z'). Defaults to now. Use this for backdating historical notes when migrating from another system. `entryAt` is preserved across subsequent update_entry calls; only `updatedAt` advances on edits. Note attribution flows to the API-token owner — there is no way to record a note as authored by a different user via this connector (a `creatorId` parameter would enable audit-attribution spoofing on shared-connector deployments, so it is intentionally not exposed).",
    ),
  activityTypeId: positiveId
    .optional()
    .describe(
      "Categorise the note under a custom activity type (Meeting, Call, ... — ids from list_activity_types). Omit for a plain Note (Capsule's default, activityType -1). Wire-verified: POST /entries accepts the id and the entry echoes {activityType: {id, name}}.",
    ),
});

export async function addNote(input: z.infer<typeof addNoteSchema>) {
  const { content, partyId, opportunityId, projectId, entryAt, activityTypeId } = input;

  assertSingleParentRef("add_note", input, { required: true });

  const body: Record<string, unknown> = { type: "note", content };
  setRef(body, "party", partyId);
  setRef(body, "opportunity", opportunityId);
  setRef(body, "kase", projectId);
  if (entryAt !== undefined) body["entryAt"] = entryAt;
  if (activityTypeId !== undefined) body["activityType"] = activityTypeId;

  return capsulePost<{ entry: unknown }>("/entries", { entry: body });
}

// ───────────────────────────────────────────────────────────────────────────
//
// update_entry: edit an existing timeline entry (typically a note Claude
// or a user added previously). Capsule's PUT semantics are partial: only
// fields you provide are changed. The most common use case is editing
// `content` on a note. The `type` field is fixed at create time and
// can't be changed via this endpoint.

export const updateEntrySchema = z.object({
  id: positiveId.describe("Entry ID to update"),
  content: z
    .string()
    .min(1)
    .optional()
    .describe(
      "New body text for the entry. For notes, this is the markdown content; for emails, the body. Provide only if you want to change it.",
    ),
  subject: z
    .string()
    .optional()
    .describe(
      "New subject line. Mostly meaningful on email-type entries; on plain notes Capsule accepts the call (HTTP 200) but **does not store the subject and does not advance `updatedAt`** — a true no-op for inapplicable fields. `entryAt` (when the note was authored) is preserved across edits; `updatedAt` advances only when an applicable field actually changes. To sort/filter by 'when did this happen', use `entryAt`; for 'last touched', use `updatedAt`.",
    ),
  removeAttachmentIds: z
    .array(positiveId)
    .min(1)
    .optional()
    .describe(
      "Attachment ids to detach from this entry (ids from the entry's attachments array; wire shape {id, _delete: true}, verified live — removal returns the entry with the attachment gone). Other attachments are untouched. Capsule rejects removing the LAST attachment from an entry that has no content. To ADD an attachment to an existing entry, use upload_attachment with entryId.",
    ),
});

export async function updateEntry(input: z.infer<typeof updateEntrySchema>) {
  const { id, ...rest } = input;
  const body: Record<string, unknown> = {};
  if (rest.content !== undefined) body["content"] = rest.content;
  if (rest.subject !== undefined) body["subject"] = rest.subject;
  if (rest.removeAttachmentIds?.length) {
    body["attachments"] = rest.removeAttachmentIds.map((attId) => ({ id: attId, _delete: true }));
  }

  if (Object.keys(body).length === 0) {
    throw new Error(
      "update_entry: provide at least one field to update (content, subject, or removeAttachmentIds)",
    );
  }

  return capsulePut<{ entry: unknown }>(`/entries/${id}`, { entry: body });
}

// ───────────────────────────────────────────────────────────────────────────

export const { schema: deleteEntrySchema, handler: deleteEntry } = defineDelete({
  toolName: "delete_entry",
  pathPrefix: "/entries",
  confirmHint:
    "Must be set to true. Permanently deletes the entry — use this to remove a note from a party/opportunity/project. Irreversible.",
  idDescription: "Entry (note/email/task-record) ID",
});
