import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockFetch } from "./test-helpers.js";
import { fetch } from "undici";

vi.mock("undici", () => ({ fetch: vi.fn() }));

beforeEach(() => {
  process.env["CAPSULE_API_TOKEN"] = "test-token";
});
afterEach(() => {
  vi.clearAllMocks();
  delete process.env["CAPSULE_API_TOKEN"];
});

describe("listPartyEntries", () => {
  it("hits /parties/:id/entries with pagination params", async () => {
    mockFetch(200, {
      entries: [
        { id: 1, type: "note" },
        { id: 2, type: "email" },
      ],
    });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({ partyId: 7, page: 1, perPage: 25 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/parties/7/entries");
    expect(url).toContain("perPage=25");
    expect(result.entries).toHaveLength(2);
  });

  // ── v1.6.6: includeLinkedPersons ────────────────────────────────────
  //
  // Capsule files each entry against exactly one party row (verified
  // v1.6.6 wire-trace probe 4 — POST /entries rejects multi-party).
  // For an org with multiple contacts, customer-facing email lands on
  // person rows; the org's own /entries response misses it. The
  // includeLinkedPersons flag tells the connector to enumerate linked
  // persons via /parties/{org}/people, fan out per-person entry
  // fetches, and merge into one feed. These tests pin the contract.

  it("default behaviour unchanged — single GET, no fan-out", async () => {
    mockFetch(200, { entries: [{ id: 1, type: "note" }] });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    await listPartyEntries({ partyId: 7, page: 1, perPage: 25 });

    // Critical canary: when includeLinkedPersons is omitted, the
    // connector MUST NOT issue the /people lookup. That's the
    // pre-v1.6.6 contract.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/\/parties\/7\/entries/);
  });

  it("includeLinkedPersons + org with 2 linked persons: fans out 1+1+2 GETs and merges", async () => {
    // Sequence: /parties/7/people → /parties/7/entries + /parties/8/entries + /parties/9/entries (3 parallel)
    mockFetch(200, { parties: [{ id: 8 }, { id: 9 }] }); // /people
    mockFetch(200, {
      entries: [{ id: 100, type: "note", entryAt: "2026-05-25T10:00:00Z" }],
    });
    mockFetch(200, {
      entries: [{ id: 200, type: "email", entryAt: "2026-05-27T12:00:00Z" }],
    });
    mockFetch(200, {
      entries: [{ id: 300, type: "email", entryAt: "2026-05-26T08:00:00Z" }],
    });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 25,
      includeLinkedPersons: true,
    });

    // 1 /people enumeration + 3 per-party /entries fan-outs (org +
    // 2 linked persons).
    expect(vi.mocked(fetch).mock.calls).toHaveLength(4);
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/parties/7/people");
    const fanOutUrls = vi
      .mocked(fetch)
      .mock.calls.slice(1)
      .map((c) => String(c[0]));
    expect(fanOutUrls.some((u) => u.includes("/parties/7/entries"))).toBe(true);
    expect(fanOutUrls.some((u) => u.includes("/parties/8/entries"))).toBe(true);
    expect(fanOutUrls.some((u) => u.includes("/parties/9/entries"))).toBe(true);

    // Merge: newest first by entryAt. The May-27 entry (person 8)
    // wins despite being created on a linked person, not the org —
    // this is the whole point of the flag.
    expect(result.entries.map((e) => (e as { id: number }).id)).toEqual([200, 300, 100]);
  });

  it("includeLinkedPersons + org with zero linked persons: collapses to single GET", async () => {
    mockFetch(200, { parties: [] }); // /people returns no linked persons
    mockFetch(200, { entries: [{ id: 1, type: "note" }] });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 25,
      includeLinkedPersons: true,
    });

    // /people lookup + single fast-path /entries. No fan-out.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toContain("/parties/7/entries");
    expect(result.entries).toHaveLength(1);
  });

  it("includeLinkedPersons + person partyId: no-op (no fan-out)", async () => {
    // A person partyId has no linked-people in Capsule's data model —
    // /people returns an empty array (verified v1.6.6 wire-trace
    // probe 5). Connector short-circuits to single GET; flag is
    // functionally inert.
    mockFetch(200, { parties: [] }); // /people on a person
    mockFetch(200, { entries: [{ id: 42, type: "note" }] });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 999,
      page: 1,
      perPage: 25,
      includeLinkedPersons: true,
    });

    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(result.entries).toHaveLength(1);
  });

  it("dedups by entry id across the merge (defensive against captured-email SMTP routing)", async () => {
    // If Capsule's SMTP ingestion ever files the same captured-email
    // entry against both an org and a linked person, naive concat
    // would surface a duplicate. The connector dedups by entry.id.
    // The probe (v166 #4) showed POST rejects multi-party, but
    // captured emails go through a separate code path we can't
    // simulate — dedup is belt-and-suspenders.
    mockFetch(200, { parties: [{ id: 8 }] });
    mockFetch(200, {
      entries: [{ id: 100, type: "email", entryAt: "2026-05-27T10:00:00Z" }],
    });
    mockFetch(200, {
      entries: [{ id: 100, type: "email", entryAt: "2026-05-27T10:00:00Z" }], // same id
    });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 25,
      includeLinkedPersons: true,
    });

    expect(result.entries).toHaveLength(1);
    expect((result.entries[0] as { id: number }).id).toBe(100);
  });

  it("merges sorted by entryAt descending; falls back to id desc on tie", async () => {
    // Two entries with identical entryAt should sort by id desc so
    // the order is total (not implementation-defined). Capsule's API
    // returns timestamps to millisecond precision so ties are rare —
    // but rare ≠ never, and a non-total sort is a sneaky bug.
    mockFetch(200, { parties: [{ id: 8 }] });
    mockFetch(200, {
      entries: [{ id: 10, type: "note", entryAt: "2026-05-27T10:00:00Z" }],
    });
    mockFetch(200, {
      entries: [{ id: 20, type: "note", entryAt: "2026-05-27T10:00:00Z" }],
    });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 25,
      includeLinkedPersons: true,
    });

    expect(result.entries.map((e) => (e as { id: number }).id)).toEqual([20, 10]);
  });

  it("applies caller's pagination window to the merged feed; nextPage when more entries remain", async () => {
    mockFetch(200, { parties: [{ id: 8 }] });
    mockFetch(200, {
      entries: [
        { id: 1, type: "note", entryAt: "2026-05-27T05:00:00Z" },
        { id: 2, type: "note", entryAt: "2026-05-27T04:00:00Z" },
      ],
    });
    mockFetch(200, {
      entries: [
        { id: 3, type: "note", entryAt: "2026-05-27T10:00:00Z" },
        { id: 4, type: "note", entryAt: "2026-05-27T09:00:00Z" },
        { id: 5, type: "note", entryAt: "2026-05-27T08:00:00Z" },
      ],
    });

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 2,
      includeLinkedPersons: true,
    });

    // Merged sorted: [3, 4, 5, 1, 2]. Page 1, perPage 2 → slice [3, 4].
    expect(result.entries.map((e) => (e as { id: number }).id)).toEqual([3, 4]);
    // 5 candidates, slice goes 0..2 → nextPage signals more remain.
    expect((result as { nextPage?: number }).nextPage).toBe(2);
  });

  it("preserves upstream nextPage when the merged page is exactly full", async () => {
    // Regression: if one linked person's first page is exactly full
    // and Capsule sends Link rel=next, the merged result still has a
    // next page even though merged.length === perPage.
    mockFetch(200, { parties: [{ id: 8 }] });
    mockFetch(200, { entries: [] });
    mockFetch(
      200,
      {
        entries: [
          { id: 11, type: "email", entryAt: "2026-05-27T11:00:00Z" },
          { id: 10, type: "email", entryAt: "2026-05-27T10:00:00Z" },
        ],
      },
      {
        Link: '<https://api.capsulecrm.com/api/v2/parties/8/entries?page=2&perPage=2>; rel="next"',
      },
    );

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 1,
      perPage: 2,
      includeLinkedPersons: true,
    });

    expect(result.entries.map((e) => (e as { id: number }).id)).toEqual([11, 10]);
    expect((result as { nextPage?: number }).nextPage).toBe(2);
  });

  it("does NOT promise a next page at the 100-entry merge ceiling (no phantom page)", async () => {
    // The merge reliably orders only the global top ~100 (each party
    // capped at 100 candidates). At a window whose end is exactly 100,
    // page+1 would need candidates beyond the cap we never fetched —
    // so even though a linked person still has an upstream Link
    // rel=next, the feed must END here rather than promise a page that
    // would come back empty. Guards the `<` (not `<=`) ceiling check.
    mockFetch(200, { parties: [{ id: 8 }] }); // /people
    mockFetch(200, { entries: [] }); // org (id 7) — empty
    // Linked person returns a full cap of 100 entries AND signals more
    // upstream. page=4 perPage=25 → requestedWindowEnd === 100.
    const hundred = Array.from({ length: 100 }, (_v, i) => ({
      id: 1000 + i,
      type: "email",
      entryAt: `2026-05-27T${String(23 - Math.floor(i / 5)).padStart(2, "0")}:00:00Z`,
    }));
    mockFetch(
      200,
      { entries: hundred },
      {
        Link: '<https://api.capsulecrm.com/api/v2/parties/8/entries?page=2&perPage=100>; rel="next"',
      },
    );

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 4,
      perPage: 25,
      includeLinkedPersons: true,
    });

    // page 4 of 25 = the window ending exactly at the 100 ceiling.
    expect(result.entries).toHaveLength(25);
    // No phantom page 5: the feed ends honestly at the ceiling even
    // though the person had an upstream rel=next.
    expect((result as { nextPage?: number }).nextPage).toBeUndefined();
  });

  it("truncates a merged window that crosses the 100-entry ceiling and ends the feed", async () => {
    // A window straddling position 100 returns only the in-ceiling tail
    // (the entries still inside the guaranteed top-100 merge), then ends
    // the feed — it does not advertise a further page into unmerged
    // older history. Complements the boundary test above with the
    // partial-window case.
    mockFetch(200, { parties: [{ id: 8 }] });
    mockFetch(200, { entries: [] });
    const hundred = Array.from({ length: 100 }, (_v, i) => ({
      id: 2000 - i,
      type: "email",
      entryAt: new Date(Date.UTC(2026, 4, 27, 0, 0, 0) + (100 - i) * 1000).toISOString(),
    }));
    mockFetch(
      200,
      { entries: hundred },
      {
        Link: '<https://api.capsulecrm.com/api/v2/parties/8/entries?page=2&perPage=100>; rel="next"',
      },
    );

    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: 2,
      perPage: 75,
      includeLinkedPersons: true,
    });

    // Page 2/perPage 75 asks for positions 76..150. Only 76..100 are
    // inside the guaranteed top-100 merge ceiling, so return that tail
    // (25 entries) and do not advertise page 3.
    expect(result.entries).toHaveLength(25);
    expect((result as { nextPage?: number }).nextPage).toBeUndefined();
  });
});

describe("listOpportunityEntries", () => {
  it("hits /opportunities/:id/entries", async () => {
    mockFetch(200, { entries: [] });

    const { listOpportunityEntries } = await import("../src/tools/entries.js");
    await listOpportunityEntries({ opportunityId: 11, page: 1, perPage: 25 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/opportunities/11/entries");
  });
});

describe("listProjectEntries", () => {
  it("hits /kases/:id/entries", async () => {
    mockFetch(200, { entries: [] });

    const { listProjectEntries } = await import("../src/tools/entries.js");
    await listProjectEntries({ projectId: 22, page: 1, perPage: 25 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/kases/22/entries");
  });
});

describe("getEntry", () => {
  it("hits /entries/:id and returns the entry", async () => {
    mockFetch(200, { entry: { id: 99, type: "email", subject: "Re: deal", content: "body..." } });

    const { getEntry } = await import("../src/tools/entries.js");
    const result = await getEntry({ id: 99 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/entries/99");
    expect((result as { entry: { subject: string } }).entry.subject).toBe("Re: deal");
  });
});

describe("updateEntry", () => {
  it("PUTs to /entries/{id} with content wrapped in {entry: ...}", async () => {
    mockFetch(200, { entry: { id: 99, content: "edited" } });
    const { updateEntry } = await import("../src/tools/entries.js");
    await updateEntry({ id: 99, content: "edited" });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/entries/99");
    const i = init as { method: string; body: string };
    expect(i.method).toBe("PUT");
    expect(JSON.parse(i.body)).toEqual({ entry: { content: "edited" } });
  });

  it("supports updating subject only", async () => {
    mockFetch(200, { entry: { id: 1 } });
    const { updateEntry } = await import("../src/tools/entries.js");
    await updateEntry({ id: 1, subject: "New subject" });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      entry: { subject: "New subject" },
    });
  });

  it("rejects calls with no fields to update", async () => {
    const { updateEntry } = await import("../src/tools/entries.js");
    await expect(updateEntry({ id: 1 })).rejects.toThrow(/provide at least one field/);
  });
});

describe("listEntries (global feed)", () => {
  it("GETs /entries (no entity prefix) with pagination", async () => {
    mockFetch(
      200,
      { entries: [{ id: 1, type: "note" }] },
      { Link: '<https://api.capsulecrm.com/api/v2/entries?page=2&perPage=25>; rel="next"' },
    );

    const { listEntries } = await import("../src/tools/entries.js");
    const result = await listEntries({ page: 1, perPage: 25 });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toMatch(/\/entries\?/);
    expect(url).not.toMatch(/\/parties\/\d+\/entries/);
    expect(url).not.toMatch(/\/opportunities\/\d+\/entries/);
    expect(url).not.toMatch(/\/kases\/\d+\/entries/);
    expect(result.nextPage).toBe(2);
  });
});

describe("addNote", () => {
  it("posts a note linked to a party", async () => {
    mockFetch(201, { entry: { id: 1, type: "note", content: "Spoke to client" } });

    const { addNote } = await import("../src/tools/entries.js");
    await addNote({ content: "Spoke to client", partyId: 7 });

    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/entries");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.entry.type).toBe("note");
    expect(body.entry.party).toEqual({ id: 7 });
  });

  it("posts a note linked to an opportunity", async () => {
    mockFetch(201, { entry: { id: 2, type: "note" } });

    const { addNote } = await import("../src/tools/entries.js");
    await addNote({ content: "Progressing", opportunityId: 3 });

    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.entry.opportunity).toEqual({ id: 3 });
  });

  it("forwards entryAt verbatim for backdating", async () => {
    mockFetch(201, { entry: { id: 4 } });
    const { addNote } = await import("../src/tools/entries.js");
    await addNote({
      content: "Historical meeting",
      partyId: 7,
      entryAt: "2020-03-15T14:30:00Z",
    });
    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.entry.entryAt).toBe("2020-03-15T14:30:00Z");
  });

  it("does NOT expose creatorId — note attribution flows to the API-token owner only", async () => {
    // creatorId was briefly shipped in alpha.8 to support
    // on-behalf-of authoring (log a note attributed to a colleague
    // even though the connector's service token is making the
    // call), but removed in alpha.13 after a security review
    // (issue #11) flagged it as an audit-attribution-spoofing
    // surface on shared-connector deployments. The schema must NOT accept it; passing it to
    // safeParse should drop it (zod strips unknown keys by default).
    const { addNoteSchema } = await import("../src/tools/entries.js");
    const parsed = addNoteSchema.safeParse({
      content: "x",
      partyId: 7,
      creatorId: 99,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("creatorId" in parsed.data).toBe(false);
    }

    // And the body sent to Capsule must NOT include a `creator` field
    // even if some upstream tries to sneak one in.
    mockFetch(201, { entry: { id: 5 } });
    const { addNote } = await import("../src/tools/entries.js");
    await addNote({ content: "Plain note", partyId: 7 });
    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.entry.creator).toBeUndefined();
  });

  it("rejects malformed entryAt at the schema layer", async () => {
    const { addNoteSchema } = await import("../src/tools/entries.js");
    expect(
      addNoteSchema.safeParse({ content: "x", partyId: 1, entryAt: "not-a-date" }).success,
    ).toBe(false);
    expect(
      addNoteSchema.safeParse({ content: "x", partyId: 1, entryAt: "2024-03-15" }).success,
    ).toBe(false); // needs full ISO 8601, not just date
    expect(
      addNoteSchema.safeParse({
        content: "x",
        partyId: 1,
        entryAt: "2024-03-15T14:30:00Z",
      }).success,
    ).toBe(true);
  });

  it("throws if no link target is provided", async () => {
    const { addNote } = await import("../src/tools/entries.js");
    await expect(addNote({ content: "Orphan note" })).rejects.toThrow("exactly one");
  });

  it("throws if multiple link targets are provided", async () => {
    const { addNote } = await import("../src/tools/entries.js");
    await expect(addNote({ content: "Bad", partyId: 1, opportunityId: 2 })).rejects.toThrow(
      "exactly one",
    );
  });
});

describe("deleteEntry", () => {
  it("issues DELETE /entries/:id when confirm=true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 204,
      ok: true,
      headers: new Headers(),
      json: async () => ({}),
      statusText: "No Content",
    } as Awaited<ReturnType<typeof fetch>>);

    const { deleteEntry } = await import("../src/tools/entries.js");
    const result = await deleteEntry({ id: 99, confirm: true });

    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/entries/99");
    expect((options as RequestInit).method).toBe("DELETE");
    expect(result).toEqual({ deleted: true, alreadyDeleted: false, id: 99 });
  });
});

describe("merged timeline ceiling with multiple populated feeds", () => {
  it.each([
    { page: 3, perPage: 25, length: 25, nextPage: 4, firstId: 1950 },
    { page: 4, perPage: 25, length: 25, nextPage: undefined, firstId: 1925 },
    { page: 2, perPage: 75, length: 25, nextPage: undefined, firstId: 1925 },
    { page: 5, perPage: 25, length: 0, nextPage: undefined, firstId: undefined },
  ])("bounds page $page / perPage $perPage", async (example) => {
    mockFetch(200, { parties: [{ id: 8 }] });
    const count = Math.min(example.page * example.perPage, 100);
    const rows = (base: number, month: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: base - i,
        entryAt: new Date(Date.UTC(2026, month, 1) - i * 1000).toISOString(),
      }));
    // Org has still more recent entries upstream; the person's entries
    // must not substitute for them beyond the guaranteed merged window.
    mockFetch(
      200,
      { entries: rows(2000, 8) },
      {
        Link: '<https://api.capsulecrm.com/api/v2/parties/7/entries?page=2>; rel="next"',
      },
    );
    mockFetch(200, { entries: rows(1000, 7) });
    const { listPartyEntries } = await import("../src/tools/entries.js");
    const result = await listPartyEntries({
      partyId: 7,
      page: example.page,
      perPage: example.perPage,
      includeLinkedPersons: true,
    });
    expect(result.entries).toHaveLength(example.length);
    expect(result.nextPage).toBe(example.nextPage);
    expect((result.entries[0] as { id: number } | undefined)?.id).toBe(example.firstId);
  });
});
