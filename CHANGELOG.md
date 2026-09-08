# Changelog

All notable changes to capsulemcp.

The full release notes for each tagged version live on GitHub:
<https://github.com/soil-dev/capsulemcp/releases>. This file mirrors the
high-level summary so it's discoverable from the repo and on npm.

The format follows [Keep a Changelog](https://keepachangelog.com), and
versions adhere to [Semantic Versioning](https://semver.org).

## [Unreleased]

## [2.3.0] — 2026-09-08

The issue #112 release: a full delta sweep against Capsule's current
API closed every gap it found. Embed allow-lists are now per-resource
and cover nested-ref enrichment (the v2.0.0 lists were over-
restrictive); the write surface gains tracks-at-create, opportunity
duration, task recurrence, note activity types, and entry-attachment
removal; three new read tools land (`list_activities`,
`list_countries`, `list_currencies`); `since` works on all search
tools; 202 Accepted deletes are surfaced as `scheduled: true`. Every
wire shape was probed live before implementation and re-verified
through the shipped code (`scripts/wire-trace-v230.ts`). 92 tools
(53 read-only), 613 tests. Soaked in production for 23 days with
zero failure events before this cut.

### Added

- **`list_activities`** — global cross-entity activity feed
  (`GET /activities`): typed rows (Note, Task completed, Email
  sent/received, custom types) with the acting user, the apiClient
  that made the change, and refs to the record concerned; `since` +
  pagination. One call answers "what happened across the tenant this
  week" — previously approximated by per-record entry fan-outs.
  CAVEAT: undocumented Capsule endpoint (discovered by live probe;
  stable in observation) — could change without notice.
- **`list_countries`** — Capsule's 250-row country dictionary; the
  `name` values are the exact spellings the address-country field
  accepts (the authoritative fix for the 422 'unknown country' class).
  Cached reference data.
- **`list_currencies`** — Capsule's 80-row currency dictionary
  (ISO 4217 code, symbol, name); valid codes for opportunity
  `value.currency`. Cached reference data.

- **Tracks at creation time** — `create_party`, `create_opportunity`,
  and `create_project` take `trackDefinitionIds`, applying tracks
  atomically at create (previously a separate `apply_track` call per
  track). Capsule validates each definition's entity scope (422 on
  mismatch). Wire-verified end-to-end.
- **Attach files to existing entries** — `upload_attachment` gains an
  `entryId` mode (upload → PUT the token onto the entry; no new note
  created), and `update_entry` gains `removeAttachmentIds`
  (`{id, _delete: true}` delta semantics — other attachments
  untouched). Closes the long-standing IDEAS
  "add-attachment-to-existing-entry" item; both directions
  wire-verified.
- **`add_note` takes `activityTypeId`** — categorise notes under
  custom activity types (ids from `list_activity_types`); omitted =
  Capsule's default Note type.
- **Opportunity `duration` / `durationBasis`** on create and update
  (FIXED/HOUR/DAY/WEEK/MONTH/QUARTER/YEAR); cross-field guard rejects
  FIXED + numeric duration pre-flight (Capsule 422s it); the
  FIXED + `duration: null` clear is supported. Wire-verified.
- **Repeating tasks** — `create_task` takes `repeat`
  ({frequency: YEARLY|MONTHLY|WEEKLY, interval, on}); Capsule derives
  `on` from `dueOn` when omitted. Wire-verified.
- **`since` on list endpoints** — `search_parties`,
  `search_opportunities`, `list_projects`, `search_projects` accept an
  ISO-8601 `since` (only records changed on/after; pairs with the
  `list_deleted_*` audit tools for incremental sync). Wire-verified on
  all three resources.

### Changed

- Whole-record delete tools surface Capsule's long-running-deletion
  semantics: on `202 Accepted` (deletion scheduled, e.g. large party
  cascades) the envelope carries `scheduled: true` so callers don't
  misread an in-flight deletion as a failure. 204 behaviour unchanged.
- Docs: NOTES corrects its claim that no `/countries` endpoint exists
  (live: 200 with 250 rows; now exposed via the new `list_countries`),
  documents the 202 delete path and the undocumented party
  `enrichment` field; DESIGN gains an "exists upstream, adoption
  planned" table (`/activities`, `/countries`, `/currencies`) and
  re-verified dates on the not-in-v2 list.

### Fixed

- The `embed` allow-lists no longer reject valid, documented Capsule
  embed values (issue #112 P1). v2.0.0's single list
  (tags/fields/missingImportantFields) came from a probe that diffed
  top-level row keys — blind to embeds that enrich a *nested* ref.
  Each resource now carries its documented list, re-verified live
  (nested-ref key counts measured): opportunities gain `party` and
  `milestone`; projects gain `party` and `opportunity`; parties gain
  `organisation`; entries gain `party`, `project`, `opportunity`,
  `creator`, `activityType`. Task tools (`list_tasks`, `get_task`,
  `get_tasks`) now expose `embed` for the first time (`party`,
  `opportunity`, `project`, `owner`, `nextTask`). These remove N+1
  round-trips (e.g. a project plus its full party in one call).
  Callers say `project`; the client boundary translates to Capsule's
  legacy `kase` wire token on the way out — symmetric with the
  kase→project response-key normalization, and applied in `buildUrl`
  so it covers every call path. `run_saved_filter` validates embeds
  cross-field against its `entity` parameter.

### Security

- Cleared all 5 open Dependabot alerts, taking `npm audit` back to
  zero at all levels. Both packages are transitive, so the patched
  versions are pinned via `overrides`:
  - **fast-uri ^3.1.6** (4 high advisories) — host confusion and SSRF
    via percent-encoded scheme normalization, malformed-IPv6 and
    repeated-percent-decoding hostname handling, and skipped IDN
    canonicalization; via `@modelcontextprotocol/sdk` → `ajv`. The
    v2.2.0 `^3.1.5` floor fell into the newly published vulnerable
    range.
  - **qs ^6.16.0** (medium) — array-limit bypass via bracket-key comma
    parsing; via `express`. Runtime-relevant: `qs` parses query
    strings on the HTTP transport.

### Changed

- Dependencies to latest: `express-rate-limit` 8.6.2 → 8.7.0,
  `undici` 8.10.0 → 8.10.2, `zod` 4.4.3 → 4.5.4 (runtime);
  `@types/node` 26.2.0 → 26.5.0, `@biomejs/biome` 2.5.8 → 2.5.12,
  `vitest` 4.1.10 → 5.0.0 (dev, major — all 613 tests pass unchanged).
  No runtime behaviour change.

## [2.2.0] — 2026-08-16

Dependency and security maintenance. Every dependency is now at its
latest version — including a minor bump of the MCP SDK itself — and
`npm audit` is back to zero after a batch of new advisories landed
against the tree. No source change; wire behaviour re-verified against
the live Capsule API.

### Security

- Cleared all 14 open Dependabot alerts (3 high). Every affected
  package was transitive with no fix reachable by bumping direct
  dependencies, so patched versions are pinned via `overrides`:
  - **fast-uri ^3.1.5** (high) — host confusion via backslash
    authority introducer, via `@modelcontextprotocol/sdk` → `ajv`.
    Note the 3.1.4 pin from v2.1.3 fell into the vulnerable range when
    the advisory was extended.
  - **ip-address ^10.4.0** (high) — leading-zero octets decoded as
    decimal while resolvers decode them as octal, and a CIDR suffix
    suppressing special-use classification, both allowing SSRF /
    trust-boundary bypass. Arrives via `express-rate-limit`, so it is
    runtime-relevant: the unauthenticated-path limiter keys on parsed
    client IPs.
  - **hono ^4.13.1** — CORS-middleware ReDoS and `memo()` retaining
    SSR output across requests. Via the SDK's hono adapter, which this
    connector never imports.
  - **postcss ^8.5.26**, **nanoid ^3.3.18** — build-time only, via
    `tsup`.

### Changed

- `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0, `undici` 8.8.0 → 8.10.0,
  `express-rate-limit` 8.6.0 → 8.6.2 (runtime); `@types/node`
  26.1.1 → 26.2.0, `@biomejs/biome` 2.5.4 → 2.5.8 (dev). No runtime
  behaviour change — verified by the full wire-trace suite against the
  live API, plus both `dist` entries loading cleanly under the new SDK.

## [2.1.3] — 2026-07-22

Security + dependency maintenance. Resolves a high-severity transitive
advisory and takes `npm audit` to zero at all levels; also lands the
accumulated Dependabot bumps. No source or wire-behaviour change —
verified by the full wire-trace suite against the live API.

### Security

- Resolve **fast-uri** high-severity advisory (host confusion via IDN
  canonicalization / backslash authority delimiter), transitive via
  `@modelcontextprotocol/sdk` → `ajv`: fast-uri 3.1.2 → 3.1.4. This was
  failing `npm audit --audit-level=high` on the prior release.
- Take `npm audit` to **0 vulnerabilities** at all levels via
  `overrides` pinning the patched transitive versions (npm's auto-fix
  wanted a SDK downgrade): `@hono/node-server` → ^2.0.5 (Windows
  serve-static path traversal — reached only through the SDK's hono
  adapter, which this connector never imports) and `esbuild` → ^0.28.1
  (dev-server file read; build-time only, via tsup).

### Changed

- Dependency bumps: `undici` 8.5.0 → 8.7.0 and `express-rate-limit`
  8.5.2 → 8.6.0 (runtime); `typescript` 6 → 7, `@types/node` 25 → 26,
  `vitest` → 4.1.10, `@biomejs/biome` → 2.5.4 (dev); `actions/checkout`
  and `actions/setup-node` → 7 (CI). No runtime behaviour change.

## [2.1.2] — 2026-07-10

Security patch: updates undici, the connector's sole outbound HTTP
client (all Capsule API calls + the HTTP/OAuth transport), off a
version carrying a high-severity advisory cluster.

### Security

- Bump `undici` 8.4.1 → 8.5.0, resolving a high-severity advisory
  cluster affecting `undici <= 8.4.1` (`npm audit --audit-level=high`
  failed on the prior lockfile). Most relevant to this connector:
  HTTP response-queue poisoning via keep-alive socket reuse and
  Set-Cookie header injection via percent-decoding. Several other
  advisories in the cluster (SOCKS5 TLS bypass, WebSocket DoS) require
  configurations this deployment doesn't use, but undici is the one
  HTTP library every outbound call flows through, so staying current
  is defense-in-depth. Request behaviour is unchanged — verified by
  the full wire-trace suite against the live API before release.

### Changed

- Dev/CI dependency bumps grouped in the same cycle: `vitest`
  4.1.8 → 4.1.9, `@biomejs/biome` 2.4.16 → 2.5.0, and
  `actions/checkout` 6 → 7 in CI. No runtime effect.

## [2.1.1] — 2026-06-11

Docs-only patch: the practical inline-upload limit is now documented
(and the misleading 25 MB framing corrected) in the one place that has
runtime effect — the `upload_attachment` tool description an LLM
caller reads — plus DESIGN/EXAMPLES/IDEAS.

### Changed

- Documented the practical inline-upload limit honestly: the
  `upload_attachment.dataBase64` description now tells LLM callers
  that inline base64 is only viable for small files (a few tens of
  KB — the bytes must transit the model as tool-call output) and not
  to attempt large files; DESIGN.md L9 explains the structural
  bottleneck (the 25 MB cap is the wire limit for programmatic
  clients, not what a chat model can emit); EXAMPLES.md's upload
  example carries the same caveat; IDEAS.md gains the full design for
  the planned remedy, a URL-sourced upload (`sourceUrl`) with SSRF
  guards.

## [2.1.0] — 2026-06-11

Minor release: one additive field, wire-verified end-to-end (and the
full pre-release wire-trace suite re-run against the live API).

### Added

- `create_project` and `update_project` now expose `startOn` (project
  start date). It was always present on project responses but never
  settable through the connector. Wire-verified: POST stores it, PUT
  changes it, and `startOn: null` on update clears it. `update_project`
  follows the connector's usual nullable-date semantics (`undefined` =
  leave untouched, `null` = clear).

## [2.0.1] — 2026-06-11

Patch on v2.0.0, fixing the one v2 vocabulary translation that was
missed (found by an independent Codex audit, verified against the live
API: the broken path 404s, the fixed one returns 200).

### Fixed

- `get_custom_field` now maps `entity: "projects"` to Capsule's project
  custom-field endpoint (`/kases/fields/definitions/:id`), matching
  `list_custom_fields` and the rest of the v2 entity vocabulary. On
  v2.0.0 it sent the unmapped path and 404'd.
- Public tool descriptions, Glama metadata, and ops docs now reflect
  the v2 project vocabulary and 89-tool / 50-read-only catalog counts.

## [2.0.0] — 2026-06-11

Major release: the tool surface drops Capsule's legacy "kase"
vocabulary and its other naming inconsistencies — breaking changes
throughout, no back-compat aliases. The motivation is LLM ergonomics:
a consistent surface measurably improves tool selection and removes
the cross-referencing trivia ("kase means project") that every caller
previously had to know. All wire behaviour against Capsule is
unchanged (paths still hit `/kases`, body wrappers still send `kase`)
and was re-verified against the live API via the full wire-trace
suite before this release. Catalog: 89 tools (50 in read-only mode,
26 in the core tier), 8 confirm-gated destructive; 575 tests.

### Breaking

- **Response keys say `project`, never `kase`.** Every JSON response is
  deep-key-normalized at the client boundary (`kase` → `project`,
  `kases` → `projects`, `restrictedKases` → `restrictedProjects`; keys
  only, values untouched). Input/output vocabulary now match: a task
  written with `projectId: 5` reads back as `task.project.id === 5`.

- **Entity enums take `'projects'`, not `'kases'`** on the
  entity-parameterized tools (tags, custom fields, saved filters,
  tracks, additional parties). Every "Use 'kases' for projects" hedge
  is gone from the descriptions.

- **Tool renames**: `list_lostreasons` → `list_lost_reasons`,
  `list_activitytypes` → `list_activity_types` (snake_case
  convention); `show_track` → `get_track` (the surface's only `show_`
  verb). Parameter renames: `get_track`/`update_track`/`remove_track`
  take `id` (was `trackId`); `get_custom_field` takes `id` (was
  `fieldId`) — every single-record tool now uses the same name.

- **`embed` is validated.** Capsule silently ignores unknown embed
  tokens, so a typo'd embed previously returned less data than asked
  for with no error. Tokens are now checked against per-surface
  allow-lists verified empirically against the live API (`tags`,
  `fields`, `missingImportantFields` on record surfaces;
  `attachments`, `participants` on entries).

- **`create_party` enforces its promised conditional requireds** at
  the schema layer: a person needs `firstName` and/or `lastName`; an
  organisation needs `name`.

### Added

- `search_projects` — free-text project search (`GET /kases/search`,
  verified live). Parties and opportunities always had `search_*`
  tools; projects only had `list_projects`. Included in the core tier.

## [1.8.1] — 2026-06-11

Patch release on top of v1.8.0 — token-cost and robustness work from a
compat-preserving improvement review, with no wire-shape or behavior
change to any tool. Highlights: opt-in `CAPSULE_MCP_TIER=core` cuts the
~155 KB `tools/list` payload to a fraction, and the `batch_*` schemas
drop ~17 KB of duplicated description text; the stdio transport now
exits cleanly on client disconnect (no more zombie instances after a
host reconnect flap); the Capsule client's timeout plumbing moved to
`AbortSignal.timeout` (−52 lines, mid-body stalls abortable by
construction); repeated patterns consolidated into shared helpers
(parent-ref XOR, concurrency pool, pagination schema fragments, list
plumbing, the four `remove_party_*_by_id` clones); the npm package is
explicitly bin-only; and the typecheck gate now covers tests/ and
scripts/ plus six new compiler strictness flags. Catalog unchanged: 88
tools (49 read-only, 25 in the core tier), 8 confirm-gated destructive;
568 tests.

### Added

- `CAPSULE_MCP_TIER=core` — opt-in tool-catalog tiering. Registers only
  a curated ~25-tool core (search/filter/get/create/update across
  parties, opportunities, projects, tasks, plus notes, tags, and
  `get_current_user`) instead of the full 88-tool catalog. The full
  catalog serializes to ~155 KB of `tools/list` JSON (~35–40k tokens
  for clients that inject it into context) — the single biggest
  non-conversational token cost this server imposes; the core tier cuts
  it to a fraction. Default (unset, or any other value) is unchanged.
  Composes orthogonally with `CAPSULE_MCP_READONLY`.

### Changed

- The five `batch_*` tools no longer duplicate their single-tool item
  schema's nested `.describe()` text on the wire (~17 KB of pure
  redundancy in `tools/list` — the single tool with the canonical
  descriptions is always co-registered). Validation is byte-identical:
  the description-stripped clone preserves all checks and refinements,
  pinned by tests including a nested `superRefine`.

- The npm package is now explicitly bin-only: the `main` field is
  removed, so an accidental `import "capsulemcp"` fails at resolve time
  instead of executing the stdio entry inside the importing process
  (which validates env and can call `process.exit`). `npx capsulemcp`
  and the `bin` install path are unchanged. The `prepare` script now
  reuses `npm run build` instead of duplicating its command line.

- The `typecheck` gate now covers `tests/` and `scripts/` (≈10k LOC that
  previously relied on runtime failures to catch type drift) via a
  second project file, `tsconfig.tests.json`; the latent type errors it
  surfaced in test files were fixed with no behavior change. Also
  removed the unused `cacheGet` back-compat shim and the dead
  `TokenType` export, and corrected IDEAS.md's stale claim that
  tag-definition delete is unimplemented (shipped in v1.7.0 as
  `delete_tag_definition`).

### Fixed

- stdio transport now exits cleanly when the MCP client disconnects —
  stdin EOF/close/error, a broken stdout pipe (EPIPE), or being
  reparented to init (the host process died). Previously the stdio entry
  wired no disconnect handling and the SDK transport never watches stdin
  for EOF, so an instance abandoned by the host (e.g. during a Claude
  Desktop reconnect flap) lingered indefinitely as a zombie —
  accumulating duplicates that pin resources and can confuse the host's
  next connection, surfacing as client-side timeouts. Mitigation, not a
  full cure: it can't stop a host from spawning a duplicate or force-exit
  an idle instance whose pipes the host still holds open (both host-side),
  but a genuinely disconnected instance now terminates promptly. HTTP
  transport unaffected.

## [1.8.0] — 2026-06-10

Minor release on top of v1.7.0 — observability and reliability hardening
from a full codebase audit, plus broader MCP Tasks support. Highlights:
forced `capsule.timeout` / `capsule.error` / `capsule.ratelimit` events
make a hung, connection-failed, or rate-limited outbound Capsule call
visible in the logs (timeouts now cover the mid-body stall too); MCP
Tasks (SEP-1686) work on the stdio transport, not just HTTP; and the task
store's result-retention window, a `chunkedMultiGet` response-shape
asymmetry, and 429 connection-pool hygiene are all fixed. Internally:
the transitive dependency advisories were cleared, the Node engine floor
corrected to match undici, and the OAuth refresh / `redirect_uri` /
auth-code-expiry paths gained test coverage. Catalog unchanged at 88
tools (49 in read-only mode), 8 confirm-gated destructive; 560 tests.

### Added

- MCP Tasks (SEP-1686) now work on the **stdio transport**, not just
  HTTP. The stdio entry supplies a fixed synthetic `clientId`
  (`stdio-local`) for the task store's single-tenant scope, so
  `MCP_TASKS_ENABLED=1` wires the task-augmented `batch_*` tools when
  running locally (e.g. `npx capsulemcp` in Claude Desktop), exactly as
  it already did over OAuth/HTTP. Off by default; unchanged when the flag
  is unset.

- Forced `capsule.timeout`, `capsule.error`, and `capsule.ratelimit`
  observability events, emitted the instant an outbound Capsule call
  fails on a path that `capsule.request` (emitted post-body) can never
  cover — leaving such failures invisible to log analysis, which is
  exactly what made intermittent "it times out sometimes" reports so
  hard to pin down. Coverage:
  - `capsule.timeout` — the 60s `AbortController` fired, **at the fetch
    stage *or* mid-body** (`res.json()`/stream read). The mid-body case
    previously surfaced as a misleading `capsule.request status=200`
    with a ~60s duration (and, since `capsule.request` is verbose-gated
    while `capsule.timeout` is forced, was invisible under default
    logging); it now shares the forced timeout fingerprint.
  - `capsule.error` — the fetch rejected before headers (connection
    refused/reset/DNS), with a low-cardinality `code` (`ECONNRESET`,
    `UND_ERR_CONNECT_TIMEOUT`, …) — never the raw message.
  - `capsule.ratelimit` — the single 429 retry was also throttled
    (after up to 60s of backoff); previously this terminal path threw
    with no trace at all.

  All carry the redacted endpoint + `elapsedMs` and feed
  `tool.chain.capsuleCalls`, so a `/mcp` request whose latency ballooned
  on a hang or backoff is explained rather than silently uncounted.
  Forced/always-on like `batch.complete` — rare, low-cardinality,
  useful with zero configuration. Internally, the duplicated 504 timeout
  message is now a single `CapsuleTimeoutError` type (which is also how
  the body-stage timeout is told apart from a genuine upstream 504).

### Fixed

- Task store (MCP Tasks, `MCP_TASKS_ENABLED=1` — off by default): the
  per-client `owners`/`abortControllers` augment-map eviction timer was
  scheduled once at `createTime + ttl` and never reset, while the SDK
  store resets its own retention timer to `completionTime + ttl` on
  terminal transitions. A task that completed late in its TTL therefore
  had its owner entry evicted while the SDK still held the result —
  `tasks/get` / `tasks/result` returned "Task not found" to the
  legitimate owner for a result the server still had, for a window up to
  one TTL wide. The augment-map sweep now reschedules in lockstep with
  the SDK on `storeTaskResult` and terminal `updateTaskStatus`.

- `chunkedMultiGet` (the `get_parties` / `get_opportunities` /
  `get_projects` / `get_tasks` fan-out) now returns the same shape on the
  multi-chunk path as on the single-chunk path — non-array sibling keys
  from the first chunk are preserved rather than dropped, removing a
  count-dependent surprise. No observable change today (Capsule's
  multi-id GET returns only the array), but the contract is now uniform.

- The Capsule client cancels the unread body of a `429` response before
  the back-off sleep (and before throwing on a double-429), so the
  underlying connection returns to undici's pool promptly instead of
  being pinned until GC.

## [1.7.0] — 2026-05-29

Minor release on top of v1.6.5 — first version to add net-new tools
since the 1.6 line began, hence the minor bump. Highlights:
`list_party_entries` can now fold an organisation's linked-people
timelines into one merged feed (`includeLinkedPersons`); a new
`delete_tag_definition` tool cleans up tenant-global tag definitions
(not just per-record detach); MCP tool annotations now emit an
explicit `{readOnlyHint, destructiveHint}` pair on every tool instead
of relying on the spec's destructive-by-default; and the HTTP entry
serves a small landing page at `/`. Internally, the four batch-fetch
handlers were de-duplicated behind a shared `chunkedMultiGet` helper.
Catalog: 88 tools (49 in read-only mode), 8 confirm-gated destructive.
All API behaviours empirically verified via the committed
`scripts/wire-trace-v16{4,5,6,7}.ts` probes.

### Added

- **`delete_tag_definition` (write, destructive, confirm-gated).**
  Deletes a tag DEFINITION from an entity type's tag namespace
  (parties / opportunities / kases), removing it from every record
  that shared it — distinct from `remove_tag_by_id`, which only
  detaches a tag from one record and leaves the definition intact.
  Closes the "stranded test / typo tag definitions can't be cleaned
  up through the connector" gap. Endpoint verified empirically
  (`scripts/wire-trace-v167.ts`): `DELETE /<entity>/tags/{id}` → 204,
  with a follow-up read confirming tenant-wide removal. Idempotent on
  404; mirrors the other `delete_*` tools' confirm gate and
  destructive annotation. Tool catalog 87 → 88; destructive-hinted
  tools 7 → 8.

- **`GET /` now serves a small HTML landing page** — a short
  human-readable body pointing at `/mcp` and the GitHub repo, plus
  `<link rel="icon" type="image/svg+xml" href="/icon.svg">` and
  `<link rel="apple-touch-icon" href="/icon.svg">` tags in the
  head. Before this, hitting the root URL in a browser returned
  Express's default "Cannot GET /" — now a curious visitor (or a
  favicon checker that parses HTML) gets something useful.

  Scope note: this does NOT change how Claude.ai's connector UI
  displays the server icon. We empirically traced that mechanism
  to a favicon crawler (AWS-hosted, hourly, browser user-agents)
  that fetches `/favicon.ico` directly — it does not parse the
  landing-page `<link>` tags, and it only crawls **custom domains**,
  not Public-Suffix-List platform subdomains like `*.run.app`. The
  load-bearing route for that crawler (`/favicon.ico`) predates
  this change; getting Claude.ai to show the icon requires mapping
  the service to a custom domain, which is infra-side, not a code
  change here. The landing page stands on its own DX merit. 6 new
  tests in `tests/http-app.test.ts` cover content-type, the two
  `<link>` tags, the `/mcp` reference, cache-control, and a
  determinism check.

### Changed

- **Internal: consolidated the four batch-fetch handlers'
  chunk-and-fan-out logic into one helper** (`chunkedMultiGet` in
  `src/capsule/multi-get.ts`). `get_parties`, `get_opportunities`,
  `get_projects`, and `get_tasks` each hand-rolled the identical
  "≤10 ids → single GET, else split into 10-id chunks, fan out in
  parallel, concatenate" block; they're now one-line delegations.
  No behavioural or API change — the "Capsule caps multi-id GET at
  10" rule now lives in one place. Covered by per-handler batch tests,
  including the >10-id chunking path for all four callers.

### Fixed

- **`list_party_entries` merged-timeline pagination (the
  `includeLinkedPersons` path).** Two off-by-one-class bugs in the
  fan-out merge:
  (1) it under-fetched for `page > 1` — only `perPage` candidates
  were pulled per linked party, so a second page sliced from too
  small a pool and could come back short or empty;
  (2) it falsely reported `nextPage: undefined` on an exactly-full
  page 1 even when linked parties still had older entries upstream
  (the per-party `Link rel=next` signal was discarded), so callers
  stopped paging early.
  Now the connector fetches `min(page × perPage, 100)` candidates per
  party and preserves each party's upstream next-page signal when the
  NEXT window still falls strictly within the per-party fetch cap.
  The merge has an inherent ceiling — a top-100-per-party merge
  reliably orders only the most-recent ~100 entries across the org +
  its people — so at exactly that ceiling the feed now ends honestly
  (the next-page signal uses a strict `< 100`, not `<= 100`, to avoid
  promising a phantom empty page) rather than reporting "approximate."
  The schema description states the ceiling explicitly and directs a
  specific contact's deeper history to `list_party_entries` on that
  person's id (the default single-GET path paginates natively with no
  ceiling). The default (`includeLinkedPersons` omitted) path is
  unchanged.

- **Tool annotations now emit `{readOnlyHint, destructiveHint}`
  explicitly on every tool — never rely on MCP spec defaults.** Per
  spec, `destructiveHint` defaults to `true`. The pre-fix
  `inferAnnotations` returned `{readOnlyHint: true}` for read tools
  and `undefined` for non-destructive writes, both of which
  resolved (in spec-compliant clients) to an implicit
  `destructiveHint: true`. Real-world Claude clients have been
  observed honoring that implicit-true even when `readOnlyHint:
  true` is also set, despite the spec saying `destructiveHint` is
  "meaningful only when readOnlyHint == false". Result: routine
  reads and additive writes (add_note, add_tag, create_party,
  update_party, every `batch_*`) were getting the same UI weight
  as `delete_party` in some client paths.

  After the fix, every tool emits a full hint pair (counts reflect
  the full v1.7.0 catalog, including `delete_tag_definition` added
  later in this same release):
  - reads → `{readOnlyHint: true, destructiveHint: false}` (49)
  - destructive (delete_* incl. delete_tag_definition, + remove_track
    + remove_additional_party) → `{readOnlyHint: false,
    destructiveHint: true}` (8)
  - all other writes → `{readOnlyHint: false, destructiveHint: false}`
    (31, was `undefined` before)

  Behavioural change is client-side only — surfaces on the next
  `tools/list` fetch (typically every new MCP connection). No tool
  runtime behaviour changes, no input schemas change. The pure-helper
  unit tests + the SDK round-trip test in
  `tests/tool-annotations.test.ts` lock the new contract.

### Added

- **`list_party_entries.includeLinkedPersons` (optional, default
  `false`).** Opt-in flag that surfaces entries filed against an
  organisation's linked people in addition to the org's own
  entries. Closes a long-standing workflow gap: Capsule's API files
  each entry against exactly one party row (verified v1.6.6
  wire-trace probe 4 — `POST /entries` rejects multi-party bodies
  with 422 "entry must be linked to either a party, opportunity or
  kase"), so customer-facing emails typically land on a person row
  and the org's `/entries` response misses them. Pre-v1.6.6, the
  fix required a manual `get_party` → `list_party_entries(org)` →
  `list_employees(org)` → `list_party_entries(personN)` chain. With
  the flag, the connector enumerates linked persons via
  `/parties/{orgId}/people`, fans out per-person entry fetches
  in parallel (concurrency-capped via the same
  `CAPSULE_MCP_BATCH_CONCURRENCY` knob the `batch_*` writes use,
  default 5), and returns one merged feed sorted by `entryAt`
  descending, deduped by entry id.

  Behaviour when `includeLinkedPersons: true` is passed against a
  PERSON party: silent no-op — persons have no linked-people
  relationship in the data model (verified v1.6.6 probe 5,
  `/parties/{personId}/people` returns 200 with an empty array).
  The flag is safe to default-on in callers without conditional
  branching.

  Default `false` — existing callers (filter UIs, audit scripts
  that genuinely want org-row-only entries) see no behavioural
  change. The `list_party_entries` tool description in `src/server.ts`
  is updated to surface the flag prominently for the "what's new
  with $ORG?" workflow.

### Documentation

- **NOTES-ON-CAPSULE-API.md §32 (new section)** documenting the
  per-row entries semantic, the v166 probe outcomes, and the
  connector-side mitigation. Same format as the existing §27 / §31
  sections.

- **`scripts/wire-trace-v166.ts`** ships as the re-runnable probe
  harness — 5 probes covering the gap, cross-direction strictness,
  the `/people` endpoint shape, multi-party POST rejection, and the
  person-partyId no-op. Same `ZZZ-V166-*` test record tagging and
  full cleanup pattern as v164 / v165.

- **NOTES-ON-CAPSULE-API.md §33 (new section)** records two
  endpoint-existence findings from `scripts/wire-trace-v167.ts`:
  `GET /tracks` → 405 (no tenant-wide track-instance list, so a
  `list_tracks` tool is NOT buildable — orphan tracks per §25 stay
  reachable only by known id), and `DELETE /<entity>/tags/{id}` → 204
  (tag definitions ARE deletable tenant-wide, now exposed as
  `delete_tag_definition`). The probe ships for re-runnability.

## [1.6.5] — 2026-05-25

Patch release on top of v1.6.3. Combines two waves of consistency
work: a gap-driven fix for parties (teamId + nullable ownerId,
matching what was already shipping for opportunities and projects
in v1.6.3) followed by a tool-surface consistency audit that
extended the same nullability and create-time conveniences across
all entity types — opportunity owner-clear, project stage-clear,
custom `fields[]` accepted on `create_*`, and a new
`batch_update_project` to complete the batch-update trio. Net
effect: callers who learn one `update_*` / `create_*` tool can
transfer that mental model to the others without surprises. All
behavioural changes empirically verified via
`scripts/wire-trace-v164.ts` and `scripts/wire-trace-v165.ts`
against a live Capsule tenant.

### Added

- **`teamId` on `create_party` / `update_party` /
  `batch_update_party`.** Production hit the same schema-omission
  shape as v1.6.1's opportunity teamId gap, then v1.6.3's parent-ref
  sweep — parties had no way to set or change the `team` field
  through this connector even though Capsule's REST API accepts it.
  v1.6.4 plumbs it through with full nullable support: pass a team
  id to set, or `null` to unassign. Empirically verified via
  `scripts/wire-trace-v164.ts` (7 probes, person + organisation,
  full cleanup).

- **`ownerId: null` now supported on `update_party`.** Previously
  the connector documented "cannot clear the owner back to null —
  use Capsule's web UI" as a client-side guard. The v1.6.4
  wire-trace empirically refuted that: `PUT /parties/:id
  { owner: null }` succeeds on both persons and organisations and
  Capsule returns the party with `owner: null`. Schema now exposes
  `ownerId.nullable()` matching the v1.6.3 `update_project.ownerId`
  shape. The combined `{ ownerId: null, teamId: <id> }` call puts
  a party into "team-owned, no specific user" state — the common
  pattern when transferring a departed user's records.

  Reporter's exact scenario (16 organisation parties, end state
  owner=null + team=X) now achievable in one batch via
  `batch_update_party({items: [{id, ownerId: null, teamId: T}, ...]})`.

- **`ownerId: null` now supported on `update_opportunity`
  (v1.6.5 consistency sweep).** Brings the opportunity update
  surface into parity with party (v1.6.4) and project. Verified
  empirically via `scripts/wire-trace-v165.ts` probe A1:
  `PUT /opportunities/{id} { owner: null }` succeeds (200), and
  the combined `{ owner: null, team: {id} }` puts an opp into
  team-owned-no-user state in a single call (probe A2). Removes
  the only remaining "cannot clear owner via API" caveat across
  the three `update_*` tools — callers can now apply the same
  null-clear mental model uniformly.

- **`stageId: null` now supported on `update_project`
  (v1.6.5).** `PUT /kases/{id} { stage: null }` succeeds (200)
  and removes the project from all boards (probe B1). Owner and
  team are preserved across the stage-clear. Lets callers move a
  project off-board via PUT without needing the Capsule web UI.

- **`fields[]` on `create_party` / `create_opportunity` /
  `create_project` (v1.6.5).** Custom field values can now be set
  on creation, not just via a follow-up `update_*` call. Removes
  the create-then-update ritual previously required for any new
  record with custom field values. Verified empirically for
  `POST /parties` and `POST /kases` via probe C; inferred by
  symmetry for `POST /opportunities` (the probed tenant had no
  opportunity custom field definitions configured).

- **`batch_update_project` (v1.6.5).** New tool mirroring
  `batch_update_party` and `batch_update_opportunity` — fan-out
  of up to 50 `update_project` operations in parallel via
  `defineBatch`. Closes the asymmetry where projects were the
  only entity in the {party, opp, project} trio without a batch
  update tool. Tool catalog grows from 86 → 87.

### Fixed

- **`update_party` now applies the same §27 defensive
  read-modify-write that `update_project` and `update_opportunity`
  ship.** Capsule's PUT on `/parties` plausibly shares the
  asymmetric owner-clears-team semantic with `/kases` and
  `/opportunities`. When `update_party` is called with `ownerId`
  touched but `teamId` omitted, the connector now reads the
  party's current team and includes it in the PUT body to prevent
  the silent clear. No extra GET when `teamId` is also explicit.
  Mirrors the v1.6.1 / v1.6.3 RMW pattern via the existing
  `readEntityRefs` helper (extended to accept `responseKey:
  "party"`).

### Changed

- **Tool-surface consistency (v1.6.5).** The `update_*` and
  `create_*` tools across party, opportunity, and project are now
  uniform: `ownerId` and `teamId` are nullable on all three
  `update_*` tools, `fields[]` is accepted on all three `create_*`
  tools, and all three entity types have a corresponding
  `batch_update_*` companion. Callers who learn one tool's API
  can transfer that mental model to the others without surprises.

### Documentation

- **`create_party` and `update_party` tool descriptions** in
  `src/server.ts` updated to mention the new `teamId` field
  and the nullable `ownerId` behavior. Integration test
  (`tests/mcp-integration.test.ts`) extended to assert
  `update_party` description contains both `organisationId`
  AND `teamId`.

- **`update_opportunity` and `update_project` tool descriptions**
  (`src/server.ts`) updated to surface the new nullable owner /
  stage behavior. Integration test extended to assert
  `update_opportunity.description` mentions `ownerId` + `null`
  and `update_project.description` mentions `stageId` + `null`.

- **Parent-ref nullability cross-references** added to
  `update_task.partyId`, `update_opportunity.partyId`, and
  `update_project.partyId` descriptions so callers see the
  difference up front: tasks can be orphaned (partyId nullable),
  opportunities and projects cannot (Capsule rejects null).

- **NOTES-ON-CAPSULE-API.md §31** extended with the empirical
  findings on `PUT /parties` party-team semantics — including
  the Capsule-side owner∈team membership constraint that
  applies to parties (same 422 message as /kases and
  /opportunities) and the fact that the membership rule does
  NOT fire when owner is null (verified by probe G).

- **NOTES-ON-CAPSULE-API.md §27** extended with the v1.6.5
  findings: opportunity owner-clear, project stage-clear, and
  custom-field writes accepted on POST (not just PUT).

- **`scripts/wire-trace-v164.ts`** ships as the reusable probe
  harness for the party-team behavior verification — 7 probes
  covering person + organisation × set/null/owner-null
  combinations, full cleanup on exit.

- **`scripts/wire-trace-v165.ts`** ships as the consistency-sweep
  probe harness — 6 probes covering opportunity owner-clear,
  project stage-clear, and custom-field writes on create, with
  full cleanup on exit and dynamic tenant discovery (no
  tenant-specific values hardcoded).

## [1.6.3] — 2026-05-25

Patch release on top of v1.6.2. Adds the four parent-reference
fields that were missing from the `update_*` schemas, plus the
tool-description sweep so the new capability surfaces at
`tools/list` for LLM routing. Production-driven (the gap was hit
three times in a week before this fix); empirically verified
against a live tenant. No tool surface change, no env-var change;
safe in-place upgrade from v1.6.0 / v1.6.1 / v1.6.2.

### Added

- **Re-parenting / re-linking on `update_*` tools.** Four
  `update_*` schemas were missing the parent-reference fields they
  needed, so callers couldn't change a record's primary parent
  without falling back to Capsule's web UI. Production hit this
  three times in a week (re-parenting opp, attaching orphan person
  to org, re-linking a task). All four are now plumbed through:

  - **`update_opportunity.partyId`** — reassign opp to a different
    primary party. `null` rejected by Capsule with 422 'party is
    required' (verified empirically), so schema doesn't expose nullable.
  - **`update_party.organisationId`** — link a person to an
    organisation, or `null` to orphan. Silently ignored when passed
    on an organisation-typed party (Capsule's API quirk; no client
    guard since the no-op is harmless).
  - **`update_project.partyId`** — same shape as opportunity;
    re-parent only, no null.
  - **`update_task.partyId` / `opportunityId` / `projectId`** —
    all three settable + nullable (orphan supported). Client-side
    XOR check rejects two non-null parent-refs in a single call,
    mirroring `create_task`'s existing constraint. `null + id`
    atomic swap supported (`partyId: null, opportunityId: 123`).

  All wire-trace verified (`scripts/wire-trace-v163.ts`) against a
  live tenant before exposing. Findings documented in
  NOTES-ON-CAPSULE-API.md §31. 10 new tests, 496 total.

  `batch_update_opportunity` / `batch_update_party` inherit the
  new fields via the shared item schemas — no code change for batch.

### Documentation

- **Top-level tool descriptions** for `update_opportunity` /
  `update_party` / `update_project` / `update_task` now mention
  the new parent-reference fields, so the capability surfaces at
  `tools/list` for LLM routing (not just at the per-field
  `.describe()` level the model sees later). Integration test
  asserts the four descriptions stay aligned with their schemas.

- **NOTES-ON-CAPSULE-API.md §31** added — empirically verified
  PUT semantics for the four parent-reference fields (when null
  is accepted, when it 422s, when Capsule silently ignores).
  §27 now forward-references §31 to complete the linkage.

- **HOWTO.md** test count and bundle sizes refreshed
  (469 → 496 tests; ~147 / ~173 KB → ~153 / ~180 KB).

- **`tests/bundle-shape.test.ts`** canary comment refreshed to
  the current bundle sizes (the band itself is unchanged).

## [1.6.2] — 2026-05-25

Patch release on top of v1.6.1. Three production-driven fixes plus
the internal-quality refactor sweep, all surfaced by the
opportunity-team work that landed in v1.6.1. No new tool surface,
no env-var changes; safe in-place upgrade from v1.6.0 / v1.6.1.

### Fixed

- **All Capsule entity ID fields now accept integer-shaped strings**
  via a narrow shared coercion helper. Production data surfaced a class of
  intermittent `Input validation error: expected number, received
  string` rejections that traced to LLM-driven MCP clients
  serializing IDs as JSON strings on some calls and integers on
  others (non-deterministic across calls — same logical input,
  different wire type). Coercion is intentionally limited to decimal
  digit strings (`"123"` → `123`); booleans, arrays, objects,
  floats, exponent notation, empty strings, and arbitrary text still
  reject instead of flowing into destructive tool paths.
  Applied uniformly across `id`, `partyId`, `opportunityId`,
  `projectId`, `milestoneId`, `ownerId`, `teamId`, `stageId`,
  `lostReasonId`, `entityId`, `trackId`, `definitionId`,
  `fieldId`, `pipelineId`, `boardId`, `addressId`, `emailAddressId`,
  `phoneNumberId`, `websiteId`, `organisationId`, `tagId`,
  `trackDefinitionId`, and the `ids` array on every batch-fetch tool.
  Centralised in `src/tools/shared-schemas.ts` so future ID schemas
  pick the contract up automatically. Non-ID positive integers
  (`page`, `perPage`, `probability`, monetary `amount`) remain
  strict — coercion there would mask legitimate caller-side bugs.
  8 new tests in `tests/shared-schemas.test.ts`, 485 total.

### Documentation

- **`create_opportunity.milestoneId`** and **`update_opportunity.milestoneId`**
  descriptions now document that tenants can configure
  pipeline/milestone-reached automation rules in Capsule (Settings
  → Sales Pipeline → Automation) that mutate `owner` and/or `team`
  immediately after creation or milestone transition. The "Assign to
  a Team" automation action in particular has been observed to clear
  `owner` as an automation side-effect even when the caller passed
  `ownerId`.
  Symmetric to the board-automation note already on
  `create_project.ownerId`. Documented workaround: chain a
  `batch_update_opportunity` PUT carrying both `ownerId` and
  `teamId` — PUT does not re-fire milestone-reached triggers.

- **`list_teams`** description extends the team-membership probe
  pattern to include `batch_update_opportunity` alongside
  `update_project`, since v1.6.1 surfaced `teamId` on opportunity
  updates with the same 422-on-non-member semantic.

### Refactor (no behaviour change)

- **`defineDelete` helper** (`src/tools/define-delete.ts`)
  centralises the schema + handler pair for the five `delete_*`
  tools. Each whole-record delete now reads as a 5-line config
  block instead of a 12-line near-duplicate. Single place to
  evolve the confirm-gate enforcement, the idempotency wrapping,
  and the `{deleted, alreadyDeleted, id}` envelope.

- **`setRef` / `setNullableRef` helpers** (`src/tools/body-helpers.ts`)
  replace the `if (X) body["x"] = { id: X }` pattern repeated
  ~30 times across opportunities / projects / parties / tasks /
  entries. The null-aware variant handles the explicit-unassign
  case used by `update_project { ownerId: null }` /
  `update_opportunity { teamId: null }` in one line.

- **`readEntityRefs` helper** (`src/tools/preserve-refs.ts`)
  centralises the defensive read used by `update_project` and
  `update_opportunity` to carry `team` / `stage` across an
  owner-only PUT (defeats the §27 asymmetric clear). Both update
  handlers now share one definition of the GET shape.

- **`defineBatch` helper** (`src/tools/define-batch.ts`) builds
  the schema + fan-out handler for the four `items`-shaped batch
  tools (`batch_update_party`, `batch_update_opportunity`,
  `batch_add_tag`, `batch_remove_tag_by_id`). Each batch tool
  reduces to a 6-line config block. `batch_complete_task` stays
  inline by design (uses `ids` shape, not `items`).

  **Net bundle impact**: `dist/index.js` 149.36 KB / `dist/http.js`
  175.85 KB — bundle SHRANK ~0.6 KB despite added helper code, as
  the deduplication outweighs the helper overhead.

## [1.6.1] — 2026-05-25

Patch release on top of v1.6.0. Two production-driven fixes (one
observability metric correction, one opportunity-team write
regression) plus the n8n integration guide and a transitive
dependency bump. No new tool surface, no env-var changes; safe
in-place upgrade from v1.6.0.

### Fixed

- **`capsule.request.durationMs` now reflects full request lifecycle,
  not just TTFB.** v1.6.0 emitted the event from inside `doFetch()`
  immediately after `fetch()` returned headers, so the metric measured
  only time-to-first-byte. Endpoints with large response bodies
  silently undercounted: 48 h of v1.6.0 production data showed
  `list_entries` (tenant-wide entries feed) at 542 ms in the dashboard
  vs 2720 ms in `tool.call.durationMs` — the 2178 ms gap was body
  stream + JSON parse, which the metric missed. Other endpoints
  weren't visibly wrong because their bodies were small (<10 ms read
  time). Moved the emit past body consumption so `durationMs` now
  spans request issued → body fully read; body-stream cost is now
  attributed correctly. No event-shape change; existing analytics
  queries continue to work with more accurate numbers.

  Affects all outbound Capsule HTTP helpers in `src/capsule/client.ts`:
  `capsuleGet`, `capsuleGetCached`, `capsulePost`, `capsulePostNoContent`,
  `capsulePut`, `capsuleSearch`, `capsuleDelete`, `capsuleGetBinary`,
  `capsulePostBinary`. New `consumeBody` helper centralises the
  emit-after-body-read pattern; one new test pins the contract.
  470 tests total at the time of this fix.

- **`update_opportunity` and `batch_update_opportunity` no longer
  silently clear `team` when only `ownerId` is supplied.** Capsule's
  PUT `/opportunities/:id` mirrors the asymmetric owner/team semantic
  documented for `/kases` in NOTES-ON-CAPSULE-API.md §27: setting
  `owner` in the body clears `team` unless `team` is also supplied;
  setting `team` alone preserves the existing `owner`. Production
  bug report: bulk-assigning ownership to a user stripped team
  affiliation across 30 opportunities. Applied the same defensive
  read-modify-write pattern that `update_project` already uses —
  when `ownerId` is touched and `teamId` is omitted, the connector
  fetches the opportunity's current team and includes it in the PUT
  body so the team is preserved. One extra `GET /opportunities/:id`
  on the owner-touched code path; no overhead when `teamId` is also
  explicit. 477 tests total (7 new for opportunity-team coverage).

### Added

- **`teamId` on `create_opportunity`, `update_opportunity`, and
  (via the shared schema) `batch_update_opportunity`.** Capsule
  opportunities carry both `owner` (a user) and `team` independently,
  but the connector previously only exposed `ownerId` — the team
  field could only be set via Capsule's web UI. The new `teamId`
  parameter takes a positive integer (discover IDs via `list_teams`)
  to assign a team, or `null` on update to clear it. Same ownership
  shapes as projects: owner alone, team alone, or owner+team (the
  owner must be a member of the team or Capsule returns 422).

### Documentation

- Added an n8n integration guide, scoped to the regular MCP Client
  node that can use capsulemcp's Streamable HTTP `/mcp` endpoint.
  The guide explicitly calls out that n8n's documented AI Agent MCP
  Client Tool sub-node is SSE-only today, while capsulemcp does not
  serve `/sse`.

### Dependencies

- Transitive `qs` 6.15.1 → 6.15.2 (patch-level bug fixes in
  `stringify`/`parse`; reaches us via `express`).

## [1.6.0] — 2026-05-20

**v1.6.0 stable — graduates the v1.6 line.** This cut moves the npm
`latest` pointer from `1.0.1` to `1.6.0`. Identical code to
`1.6.0-rc.3`; the only diff vs rc.3 is the version string and this
CHANGELOG entry.

Distribution tag `latest` on npm. `npx capsulemcp` and `claude mcp
add capsule -- npx -y capsulemcp` now resolve to this release.

### What's in v1.6 vs v1.0.x

Feature highlights, accumulated across the alpha + beta + rc series
and shipping here:

- **MCP Tasks (SEP-1686)** support — per-clientId scoped store,
  capability advertisement gated on `MCP_TASKS_ENABLED=1`, the five
  `batch_*` writes opt into `taskSupport: "optional"` (zero break
  for existing callers via SDK auto-poll fallback), task
  cancellation halts the batch fan-out mid-flight, full lifecycle
  production-verified with augmented write round-trip.
- **MCP `ToolAnnotations`** inferred from the catalogue naming
  convention. 49 read tools carry `readOnlyHint: true`; 7 destructive
  tools carry `destructiveHint: true`; the remaining 30 writes carry
  no annotation. Clients that honor the hints can auto-approve safe
  reads while still prompting on writes/destructive calls.
- **Per-tool / per-Capsule observability events** (`tool.call`,
  `capsule.request`, `tool.chain`) for retroactive optimization
  analysis. Gated on `CAPSULE_MCP_LOG_VERBOSE=1`. Numeric IDs and
  query strings redacted from logged paths; only argument NAMES are
  logged, never values.
- **Six new env vars** for Tasks + observability tuning, all
  default-safe; documented in DEPLOY.md.
- **Front-page batch fetch cap** raised from 10 → 50 ids per call
  (`get_*` plural tools), split internally across Capsule's native
  10-id endpoint cap.
- **469 tests** (up from 337 on v1.0.1).
- **Bundle**: `dist/index.js` ~147 KB, `dist/http.js` ~173 KB.

### Compatibility

- **No breaking changes** vs v1.0.1 in the tool surface or env vars.
  All v1.0.x configs continue to work unchanged.
- The new env vars (`MCP_TASKS_*`, `CAPSULE_MCP_LOG_VERBOSE`) default
  to safe values; ignore them and behaviour matches v1.0.x.
- Tasks capability is advertised only when `MCP_TASKS_ENABLED=1`;
  clients that don't request it (or don't know about it) get the
  same response shapes as before.

### Fixed (since rc.3)

- Softened MCP annotation docs to describe `readOnlyHint` /
  `destructiveHint` as client hints, not security guarantees, and
  refreshed the documented local test count to 469.

## [1.6.0-rc.3] — 2026-05-20

Third release candidate. **User-visible improvement:** tools now
carry MCP `ToolAnnotations` so clients that honor these hints can
auto-approve safe reads instead of prompting before every call.

Distribution tag `next` on npm — does NOT move `latest`.

### Added

- **MCP `ToolAnnotations` inferred from the catalogue naming
  convention.** Every tool now carries `readOnlyHint: true` (49
  tools — `search_*` / `filter_*` / `get_*` / `list_*` / `show_*` /
  `run_*`) or `destructiveHint: true` (7 whole-record-delete +
  workflow/party-association removers — same set the existing
  `confirm: true` schema gate covers). The remaining 30 writes
  carry no annotation; clients fall back to their default
  (typically: prompt).

  Client impact (load-bearing):

  - Claude Desktop / Code can use these hints to auto-approve the
    49 read tools while still prompting for writes. No more
    confirmation prompt for every `list` / `get` / `search` /
    `filter` call when the client trusts and honors the hints.
  - Glama and other registry-scrape clients see properly tagged
    catalogue entries for quality scoring.
  - Other MCP clients: annotations are hints per spec; defaults
    unchanged.

  Inference centralised in `inferAnnotations(name)` in
  `src/server/register-tool.ts`. A new aggregate-counts assertion
  (49 + 7 + 30 = 86) trips CI if a future tool drifts from the
  convention, forcing an explicit annotation decision instead of
  silent default. 6 new tests, 469 total.

## [1.6.0-rc.2] — 2026-05-20

Second release candidate. Closes four docs/process gaps the rc.1
audit missed. No runtime behaviour change.

Distribution tag `next` on npm — does NOT move `latest`.

### Fixed

- Corrected stale docs that still described `get_*` batch-fetch tools
  as 10-id caller-facing tools. v1.6 accepts up to 50 ids and splits
  internally across Capsule's native 10-id endpoint cap. Three files
  touched: `README.md` (front-page claim), `DESIGN.md`, and
  `OPTIMIZATIONS.md`.
- Clarified HOWTO npm pre-release tagging: beta cuts use `--tag beta`;
  release candidates use `--tag next`. The rc.1 checklist only
  mentioned `--tag beta`.
- Added an explicit post-publish `npm view` registry check to the
  release checklist so a GitHub tag/release cannot be mistaken for an
  installable npm version. (A git tag does not make
  `npx capsulemcp@X.Y.Z` resolvable — only `npm publish` does.)
- Refreshed the Vitest dev-dependency lock from 4.1.6 to 4.1.7 so
  `npm outdated` is clean before the final release.

## [1.6.0-rc.1] — 2026-05-20

First release candidate for the v1.6 line. Collects every fix /
polish item from the four-beta cycle plus the pre-release audit.
**No new feature surface vs beta.5** — this RC is about polish,
metadata, and tool-description quality before flipping the npm
`latest` pointer.

Distribution tag `next` on npm — does NOT move the `latest`
pointer, which stays on v1.0.1. Install via
`npx capsulemcp@1.6.0-rc.1` or `capsulemcp@next`.

Once the RC has soaked in real production traffic with no
regressions, the next cut is **v1.6.0 stable** (which WILL move the
`latest` pointer to the v1.6 line).

### What's in v1.6 vs v1.0.x

Feature highlights, accumulated across the alpha + beta series and
landed here:

- **MCP Tasks (SEP-1686)** support — per-clientId scoped store,
  capability advertisement gated on `MCP_TASKS_ENABLED=1`, the five
  `batch_*` writes opt into `taskSupport: "optional"` (zero break
  for existing callers via SDK auto-poll fallback), task cancellation
  halts the batch fan-out mid-flight, full lifecycle production-
  verified with augmented write round-trip
- **Per-tool / per-Capsule observability events** (`tool.call`,
  `capsule.request`, `tool.chain`) for retroactive optimization
  analysis; gated on `CAPSULE_MCP_LOG_VERBOSE=1`; numeric IDs and
  query strings redacted from logged paths
- **Six new env vars** for tasks tuning, all default-safe; documented
  in DEPLOY.md
- **469 tests** (up from 337 on v1.0.1)
- **Bundle**: dist/index.js ~147 KB, dist/http.js ~173 KB

### Fixed (since beta.5)

- Hardened `/mcp` rate-limit env parsing: malformed or negative
  `MCP_HTTP_RATE_LIMIT_*` values now fall back to safe defaults, and
  over-large windows clamp before reaching express-rate-limit's
  timer-backed MemoryStore.
- Made `scripts/wire-trace-tasks.sh` match the documented Cloud Run
  deployment path: it now accepts `CLIENT_ID` / `CLIENT_SECRET` from
  env first and falls back to both stack-specific and DEPLOY.md Secret
  Manager names.

### Changed (pre-release polish)

- **Tool descriptions tightened** for 5 entries that were below the
  catalogue's routing-quality bar: `get_project`, `update_task`,
  `list_party_entries`, `get_entry`, `list_stages`. Each now matches
  the depth of its peers — return shape, when to use vs related
  tools, Capsule quirks called out. Improves LLM routing accuracy
  and the quality signal for MCP-server registries that scrape tool
  descriptions.
- **Placeholder hygiene in public docs.** `DEPLOY.md` worked-example
  `REGION=europe-west1` → `REGION=<your-region>` (with a brief
  comment listing common region names). `scripts/wire-trace-tasks.sh`
  now requires `REGION` to be passed explicitly rather than
  defaulting to a specific region.
- **`package.json` metadata for registry listings.** Added
  `homepage`, `bugs`, and `author` fields. `homepage` points to the
  README, `bugs` to the issue tracker, `author` matches the LICENSE
  copyright. No effect on existing installs; improves the package
  card on npm and discovery surfaces like glama.ai.
- **`CONTRIBUTING.md` test-count drift fix.** Dropped the stale
  inline count and reordered the gate snippet so `npm run build`
  runs before `npm test` (matches CI; needed so the bundle-shape
  canary tests have `dist/` to inspect).
- **HOWTO bundle-size figures + bundle-shape test comment** refreshed
  to reflect the post-description-improvement build (~147 KB stdio,
  ~173 KB HTTP). The bundle grew ~2 KB because of the tool-description
  expansion; well within the 50–300 KB sanity band the canary
  enforces.

## [1.6.0-beta.5] — 2026-05-20

CI + docs hygiene release on top of beta.4. No runtime behaviour
change. The bundle-shape canary tests now actually run in CI
(they were silently skipping because of build-after-test ordering);
HOWTO test count and bundle sizes are refreshed; a routine
dev-dep bump keeps `npm outdated` clean.

Distribution tag `beta` on npm — does NOT move the `latest`
pointer.

### Fixed

- Activated the bundle-shape canary in CI by running `npm run build`
  before `npm test`; previously the new `dist/` assertions skipped
  on clean checkouts because the workflow tested before building.
- Refreshed HOWTO test/bundle counts for beta.4 and removed stale
  smoke-test script references from the task wire-trace helper.
- Updated direct dev dependency `@types/node` from 25.9.0 to 25.9.1
  so `npm outdated` is clean.

## [1.6.0-beta.4] — 2026-05-20

Refactor-only release on top of beta.3. No behaviour change, same
460 tests pass. Three targeted internal simplifications on the
observability code:

- Extracted `emitToolCall` helper — collapses the three
  near-identical `logEvent("tool.call", …)` blocks (registerTool
  success + error, registerToolTask IIFE) into one-line calls.
  Single place to evolve the event shape.
- Moved `tool.chain` emission into `withRequestContext` itself.
  The chain lifecycle now lives in the helper that creates the
  context — callers can never forget to emit, and the emission
  fires via `try/finally` so partial chains stay observable on
  error paths. `/mcp`'s handler in `src/http/app.ts` shrinks to a
  clean 3-line wrapper.
- Replaced the inline if/else in `logEvent`'s ctx-mutation with a
  declarative `chainHandlers` dispatch table. Adding a new
  chain-feeding event type is now one row.

Net +26 LOC because of doc comments + the dispatch table being
slightly more verbose than the inline conditionals — but each
emission site is dramatically shorter and the contract per helper
is clearer. Bundle: `dist/index.js` 144.74 KB, `dist/http.js`
170.83 KB (unchanged).

## [1.6.0-beta.3] — 2026-05-20

Observability-only release on top of beta.2. No tool surface change,
no MCP protocol change. Adds three verbose-gated event types so
retroactive optimization analysis (top tools, top Capsule
endpoints, p95 latency per endpoint, N+1 detection, cache hit
rate) is one `gcloud logging read` away. Privacy invariants
tightened across the board.

Distribution tag `beta` on npm — does NOT move the `latest`
pointer.

### Added

- **Per-tool / per-endpoint observability events** — verbose-gated
  (`CAPSULE_MCP_LOG_VERBOSE=1`). Three new event types make it
  possible to answer "which tools dominate", "which Capsule
  endpoints are slowest", "are agents N+1-calling get_party when
  they should batch", and "what's the cache hit rate by chain":
  - `tool.call` — fires once per tool invocation. Carries
    `tool`, `clientId`, `argFields` (the NAMES of populated
    schema fields — never the values), `durationMs`, `outcome`,
    and `taskAugmented?` for task-augmented runs.
  - `capsule.request` — fires once per outbound Capsule API call.
    `method`, `path` (redacted: numeric IDs → `:id`, query string
    stripped), `status`, `durationMs`, `responseBytes`,
    `retriedAfter429?`.
  - `tool.chain` — fires at the end of each `/mcp` POST. Aggregate
    summary: `tools` (the sequence in order), `toolCount`,
    `capsuleCalls`, `cacheHits`, `durationMs`.
  Per-`/mcp`-request aggregation lives in an `AsyncLocalStorage`
  frame set up by the HTTP handler; `tool.call` and `capsule.request`
  events implicitly populate the chain counters via `logEvent` so
  no context threading is needed at call sites. OPTIMIZATIONS.md §4
  documents the gcloud recipes that consume these events.

### Privacy / hygiene

- **Tightened `cache.evict` path field.** The evicted key was being
  logged in its raw form (e.g. `GET /parties/123456789?embed=tags`),
  which leaked record IDs and (in the case of `/parties/search?q=…`)
  search terms into operator logs. Now redacted to
  `GET /parties/:id` shape. Same `redactPath` helper used for all
  new event types.
- **`cache.hit` / `cache.miss` `params` field replaced with
  `paramFields`** — only the parameter NAMES are logged now, not
  the values. Aligns with the privacy model used by the new
  `tool.call` argFields.

13 new tests in `tests/log-events.test.ts` cover redactPath,
context aggregation, and the end-to-end emission shape. 460 total
tests.

## [1.6.0-beta.2] — 2026-05-19

Test-plan expansion on top of beta.1. No production-code changes —
the only diff is in tests, scripts, and docs. Bumps because the
package's test surface and verification tooling materially expanded.

### Added

- **Test plan expansion for MCP Tasks (SEP-1686)** — 11 new tests + a
  reusable production-write verifier. Total: 436 → 447 tests.
  - **`tests/tasks/lifecycle.test.ts`** (+6 tests): augmenting a
    non-task tool with `params.task` returns the SDK's loud
    validation error (pins the known SDK bug); all-items-failing
    batch reaches `completed` (not `failed`) with per-item 422s in
    the result; `tasks/result` on a cancelled task throws a
    structured error; multi-client `tasks/list` does not cross-leak;
    per-client quota exhaustion returns `-32602` via the wire
    (documents the SDK's schema-validation shadowing of our quota
    message); `tasks/cancel` immediately after `createTask` halts
    cleanly without claiming items.
  - **`tests/tasks/store.test.ts`** (+1 test): TTL eviction actually
    fires — task is removed from owner map and SDK store after its
    ttl elapses.
  - **`tests/tasks/capability.test.ts`** (+1 test): explicit stdio
    shape (no opts arg) never advertises tasks, regardless of env.
  - **`tests/bundle-shape.test.ts`** (new file, +3 tests):
    `dist/index.js` shebang invariant, `dist/http.js` non-shebang
    invariant, bundle-size band sanity. Skips gracefully if `dist/`
    is unbuilt.
- **`scripts/wire-trace-tasks.sh`** (new): production-write
  verifier for the augmented MCP Tasks lifecycle. Walks OAuth +
  initialize + augmented `batch_add_tag` + poll + `tasks/result` +
  augmented cleanup `batch_remove_tag_by_id`. Mirrors the
  in-process integration tests against a real deployed instance.
  Pair with the OAuth-only smoke test on every alpha/beta cut that
  runs with `MCP_TASKS_ENABLED=1` and `CAPSULE_MCP_READONLY=0`.
- **Smoke-test extension** (operator-side, in the deployment repo):
  5 new checks for the tasks surface — capability advertisement,
  `tasks/list` returning a result array, `tasks/get` /
  `tasks/result` / `tasks/cancel` on bogus taskIds returning
  `-32602`. Smoke went from 12 → 17 checks. Tasks endpoints are
  verified on every deploy without writing to Capsule.

### Known observability gap

When our scoped store throws `McpError(InvalidParams, "Task quota
exceeded for this client")`, the SDK catches it inside
`setRequestHandler(CallToolRequestSchema)`, wraps via
`createToolError(error.message)` into a `CallToolResult { isError:
true }`, then validates that result against the `CreateTaskResult`
schema for task-augmented requests. The schema check fails and the
client sees a `-32602` "Invalid task creation result" error instead
of our original "Task quota exceeded" text. The quota IS enforced
(no extra creations land in the store); only the error message is
obscured. Tracked in `lifecycle.test.ts` so a future SDK fix is
noticed; ergonomics fix deferred.

## [1.6.0-beta.1] — 2026-05-19

Graduates the v1.6 line from alpha into beta. The four-alpha
series shipped MCP Tasks (SEP-1686) support — capability
advertisement, per-clientId scoped task store, the 5 `batch_*`
writes opting into `taskSupport: "optional"`, full lifecycle
(`tasks/get` / `tasks/result` / `tasks/list` / `tasks/cancel`),
and per-task `AbortController` wiring so cancellation actually
halts mid-batch. End-to-end verified against the deployed
service with real Capsule writes. No new tools planned for v1.6;
beta is for bug fixes and polish.

Distribution tag `beta` on npm (when published) — does NOT move
the `latest` pointer, which stays on v1.0.1.

### Changed since 1.6.0-alpha.4

- **OPTIMIZATIONS.md placeholder hygiene.** The gcloud recipe
  examples had hardcoded the operator's specific Cloud Run service
  name and region; replaced with `<your-service>` and
  `<your-region>` placeholders matching the existing
  `<your-gcp-project>` convention. No code or behaviour change.

### Recap of the alpha series (folded into this beta)

For the full feature-by-feature history see the `[1.6.0-alpha.*]`
entries below. Headline items:

- **alpha.1**: MCP Tasks infrastructure (per-clientId scoped
  store, capability advertisement, env-gated wiring) — off by
  default; no tools opted in yet.
- **alpha.2**: 5 `batch_*` writes migrated to `registerToolTask`
  with `taskSupport: "optional"`; per-task `AbortController`
  registry so `tasks/cancel` halts the batch fan-out. Plus a
  critical hotfix for a process-crashing bug on the augmented
  path under stateless HTTP POST (notification-on-closed-stream
  was re-storing the result and tripping the SDK's "terminal
  status" guard).
- **alpha.3**: Caller-supplied `task.ttl` is honoured (was
  silently overwritten by the 5-min default). Several
  architectural cleanups: collapsed `registerToolTaskWhenEnabled`
  into a single closure-bound `registerBatchTool`, unified
  `logEvent` + `logEventAlways` into one with `{ force }`,
  extracted `BatchOpts` and shared env-readers (`src/env.ts`).
- **alpha.4**: Two correctness fixes — task augmentation
  request shape is `params.task` (not `_meta.task` as docs
  previously claimed), and the `ttl: null` branch in the scoped
  store is now actually reachable (`??` was converting `null`
  to the default before the `=== null` check). Operator-set
  sub-1000ms TTL ceilings are now floored at the polling-safe
  minimum so the config view matches store behaviour.

436 tests; production-verified end-to-end (augmented
`batch_add_tag` + augmented `batch_remove_tag_by_id` round-trip).

## [1.6.0-alpha.4] — 2026-05-19

Post-alpha.3 review found two real correctness bugs and a docs
inconsistency. None of them affect callers using our published
client code (our own tests already used `params.task` directly,
and we don't send `ttl: null` anywhere), but the published HOWTO
recipe would have actively misled any hand-built client. Upgrade.

### Fixed

- **Task augmentation request shape was misdocumented as
  `_meta.task` everywhere.** The SDK reads `request.params.task`
  directly (top-level on params, not nested under `_meta`) — see
  `protocol.js:316`. SEP-1686's spec text says `_meta`, but the
  SDK is what actually runs. HOWTO recipe, code comments, and
  CHANGELOG history corrected to `params.task`. Hand-built clients
  following the old recipe would never have activated task
  augmentation — they'd hit the synchronous auto-poll path
  instead, which works but provides none of the call-now-fetch-
  later benefit.
- **`ttl: null` branch in the scoped store was unreachable.**
  The pre-fix code did `taskParams.ttl ?? cfg.defaultTtlMs`,
  which converted `null` to the default BEFORE the `=== null`
  check — so the documented "null → maxKeepAliveMs (no
  unlimited)" branch never fired. The existing test passed only
  because the test's max happened to be smaller than the default,
  so the clamp produced the same number from a different path.
  Tightened the test to actually discriminate.
- **Operator-set TTL ceiling below 1000 ms was silently exceeded.**
  `MCP_TASKS_MAX_KEEP_ALIVE_MS=500` would expose `500` via the
  config, but the store's `Math.max(1000, ...)` floor enforced
  `1000` effective — exceeding the operator's intent. Both
  config bounds now floor at `MIN_TASK_TTL_MS = 1000`, so the
  config view matches store behaviour.
- **`CAPSULE_MCP_READONLY` documentation lagged the env-reader
  refactor.** DEPLOY.md and `tests/readonly.test.ts` now reflect
  the full truthy set (`1`/`true`/`yes`/`on`) introduced in
  alpha.3.
- **Stale `notifications/cancelled` comment removed** from the
  task-runner signal docstring. Only `tasks/cancel` fires our
  AbortController (via the `updateTaskStatus` hook in
  `src/tasks/store.ts`); `notifications/cancelled` aborts the
  original request controller, which is unrelated to background
  task work.

436 total tests (+3 new: ttl floor at safety minimum, plus two
truthy-spelling cases for `CAPSULE_MCP_READONLY`).

## [1.6.0-alpha.3] — 2026-05-19

Cleanup pass on top of v1.6.0-alpha.2. One real defect found
during the post-alpha.2 audit, plus structural simplifications.
Behaviour is unchanged for any caller that worked under alpha.2;
callers that send `params.task.ttl` now get the value they asked
for instead of a silent fallback. Distribution tag `alpha` on
npm — does NOT move the `latest` pointer.

### Fixed

- Kept `batch_*` tools callable when MCP Tasks are disabled. The
  SDK's `taskSupport: "optional"` path still uses automatic task
  polling for ordinary `tools/call` requests; registering task-aware
  handlers without a task store made default/off deployments fail
  with "No task store provided" before the underlying batch tool
  ran. Batch tools now register as task-capable only when
  `MCP_TASKS_ENABLED=1` and a clientId-backed task store is wired;
  otherwise they stay synchronous.
- **Caller-supplied `task.ttl` is now honoured.** The SDK surfaces
  the inbound `params.task.ttl` as `extra.taskRequestedTtl`, but the
  runner was calling `extra.taskStore.createTask({})` with empty
  params — silently overwriting the caller's hint with
  `MCP_TASKS_DEFAULT_TTL_MS` (5 min). The TTL-clamping logic in
  `src/tasks/store.ts` was effectively dead code for the caller-
  supplied path. New lifecycle assertion verifies the round-trip.

### Changed

- **Collapsed `registerToolTaskWhenEnabled`** into a single
  closure-bound `registerBatchTool` inside `createCapsuleMcpServer`.
  The `tasksWired` boolean is no longer threaded through 5 call
  sites; the registration decision is made once at the top. Net
  ~30 LOC reduction; behaviour identical.
- **Unified `logEvent` and `logEventAlways`** into a single
  `logEvent(event, fields, { force? })` in `src/log.ts`. Hot-path
  events (`cache.*`, `task.*`) still default to verbose-gated;
  `batch.complete` opts in with `{ force: true }`. One emitter,
  one shape.
- **Extracted `BatchOpts = { signal?: AbortSignal }`** type from
  `src/capsule/batch.ts`. The 5 `batch_*` tool functions and the
  task-runner handler signature in `src/server/register-tool.ts`
  now reference the canonical type instead of repeating the
  literal in 6 places.
- **Extracted shared env-var readers** (`readBool`,
  `readPositiveInt`) to `src/env.ts`. `getCacheTtlMs`,
  `cacheDisabled`, `getBatchConcurrency`, `getTasksConfig`,
  `isReadOnly`, and `logVerbose` all now share one parser. Side
  effect: `CAPSULE_MCP_READONLY` now also accepts `on` as a
  truthy spelling (was previously only `1` / `true` / `yes`),
  matching every other binary flag in the codebase.

### Docs

- DESIGN.md and IDEAS.md sweeps: retrospective tone (no more
  "planned for v1.6" or "v1.6 tool-side migration" — that work has
  shipped). Added a sentence to `src/tasks/store.ts` explaining
  why the owner map is separate from the SDK's
  `InMemoryTaskStore`.

## [1.6.0-alpha.2] — 2026-05-19

Hotfix on top of alpha.1. **alpha.1 is unsafe in production** — do
not run with `MCP_TASKS_ENABLED=1` against the stateless HTTP
transport. Upgrade to alpha.2.

### Fixed

- **Augmented-task lifecycle crashed the process on every call.**
  Under stateless HTTP POST `/mcp`, the SDK's `storeTaskResult`
  wrapper (`shared/protocol.js`) emits a
  `notifications/tasks/status` push after writing the result. But
  the original request's notification channel closes the instant we
  return `{ task }` synchronously, so the push throws. The runner's
  catch block treated that as a handler failure and called
  `storeTaskResult` a second time to mark the task `failed` — but
  the underlying store was already in terminal status, so the SDK
  threw "results can only be stored once". That became an unhandled
  rejection from the background `void(async()=>...)` IIFE → process
  `exit(1)` → Cloud Run instance recycled → **all in-flight tasks
  for all clients lost**. The runner now separates handler-failure
  from store-failure paths and swallows post-store notification
  errors. The result is in the underlying store regardless, so
  callers polling `tasks/result` get the right payload.

  Invisible in the alpha.1 test suite because `InMemoryTransport`
  keeps the notification channel open for the whole test session.
  New `tests/tasks/stateless-resilience.test.ts` reproduces the bug
  by force-throwing on every `notifications/tasks/status` and
  asserts (a) no unhandled rejection, (b) task reaches `completed`,
  (c) `tasks/result` returns the right body. 432 total tests.

## [1.6.0-alpha.1] — 2026-05-19

First alpha of the v1.6 line. Adds **MCP Tasks (SEP-1686)
support** — the new "call-now, fetch-later" primitive for
long-running tool calls. Off by default behind
`MCP_TASKS_ENABLED=1`; non-breaking when enabled. Distribution
tag `alpha` on npm — does NOT move the `latest` pointer.

### Added

- **MCP Tasks capability (SEP-1686).** When
  `MCP_TASKS_ENABLED=1` and an authenticated OAuth client_id is
  present, the server advertises the `tasks` capability and lights
  up the SDK's auto-handlers for `tasks/get`, `tasks/result`,
  `tasks/list`, and `tasks/cancel` against a per-clientId scoped
  wrapper around the SDK's `InMemoryTaskStore`
  (`src/tasks/store.ts`). Tenant isolation is enforced on every
  operation: a caller authenticated as client A gets `task not
  found` for any taskId owned by client B, identical to the
  genuinely-missing case. Two DoS caps (`maxPerClient`,
  `maxTotal`) bound the singleton.
- **Five `batch_*` writes are now task-augmented.**
  `batch_update_party`, `batch_update_opportunity`,
  `batch_complete_task`, `batch_add_tag`, `batch_remove_tag_by_id`
  register via `registerToolTask` with `taskSupport: 'optional'`.
  Aware clients send `params.task: { ttl }` and get a
  `CreateTaskResult` envelope back immediately, then poll
  `tasks/get` and retrieve via `tasks/result`. **Unaware clients
  are unaffected** — the SDK's `handleAutomaticTaskPolling`
  internally creates the task, polls it, and returns the final
  `CallToolResult` synchronously. Same return shape, same arguments,
  same partial-failure semantics. See HOWTO.md for the augmented-
  request pattern.
- **`tasks/cancel` halts the batch fan-out mid-flight.** A new
  per-task `AbortController` registry in `src/tasks/store.ts` is
  wired so the SDK's `tasks/cancel` (which only updates task
  status on its own) actually aborts the underlying
  `batchExecute` loop. In-flight items run to completion (we
  can't pre-empt a Capsule HTTP round-trip mid-flight), but no
  new items are claimed; the rest land in the result array as
  `cancelled` errors. The summary's `failed` count reflects the
  cancellation visibly.
- **Six new env vars** (all default-safe, all documented in
  DEPLOY.md): `MCP_TASKS_ENABLED`, `MCP_TASKS_DEFAULT_TTL_MS`,
  `MCP_TASKS_MAX_KEEP_ALIVE_MS`,
  `MCP_TASKS_DEFAULT_POLL_FREQUENCY_MS`,
  `MCP_TASKS_MAX_PER_CLIENT`, `MCP_TASKS_MAX_TOTAL`.

### Changed

- **`batchExecute` accepts an optional `signal: AbortSignal`.**
  Workers consult the signal between items and skip remaining
  slots when it fires. Non-breaking; existing call sites that
  pass no options keep their pre-tasks behaviour.

### Notes

- **In-memory store, per Cloud Run instance.** Tasks created and
  not yet polled to completion before the instance recycles
  (scale-to-zero, deploy) are silently dropped. With
  `max_instance_count=1` this is the only failure mode today. An
  external `TaskStore` (Firestore/Redis) is the future upgrade
  path noted in IDEAS.md.
- **Polling is the primary delivery channel.** The MCP
  `notifications/tasks/status` push rides the same SSE stream as
  `notifications/progress`. Under stateless HTTP POST `/mcp` the
  stream closes as soon as the original `tools/call` returns the
  `CreateTaskResult` envelope, so the notification has nowhere to
  land. Clients must poll `tasks/get` — which is the spec-
  recommended pattern for this transport shape.

23 new tests across config, store (tenant isolation, DoS caps,
TTL clamping), capability advertisement, and lifecycle
(auto-poll fallback, augmented path, cancellation halts fan-out).
431 total tests.

## [1.5.0-alpha.2] — 2026-05-19

Second alpha of the v1.5 line. Three small follow-ups since alpha.1
— two privacy/operational hardening items and one routine dep bump.
No new tool surface; no behaviour change for correct callers.
Distribution tag `alpha` on npm — does NOT move the `latest` pointer.

### Security

- **`batch.complete` no longer logs raw failure messages by default.**
  The event still emits always-on aggregate fields (`total`,
  `succeeded`, `failed`, `durationMs`, `concurrency`), but detailed
  `failureReasons` now require `CAPSULE_MCP_LOG_VERBOSE=1` because
  Capsule error messages can contain CRM data. Same trust-boundary
  reasoning as `MCP_HTTP_DEBUG`, which already gates raw `err.message`
  on the `/mcp` error path.
- **Rate-limit `keyGenerator` uses `ipKeyGenerator` helper.**
  `express-rate-limit` 8.x warns (`ERR_ERL_KEY_GEN_IPV6`) when a
  custom keyGenerator returns a raw IPv6 address, because /128
  bucketing lets a single client trivially evade the limit by
  rotating addresses inside its /64. We now run unauthenticated
  fallback IPs through `ipKeyGenerator`, which groups by /64.
  Authenticated requests still key on `clientId` and are unaffected.

### Changed

- **Dependency bumps** (Dependabot group + manual): `express-rate-
  limit` 8.5.1 → 8.5.2, `undici` 8.2.0 → 8.3.0, `@types/node`
  25.7.0 → 25.9.0. All patch/minor, no API changes consumed.

### Fixed

- **Stale tool/test-count docs updated**: 81 → 86 tools in DESIGN.md,
  DEPLOY.md, and OPTIMIZATIONS.md; 407 → 408 tests in HOWTO.md.

## [1.5.0-alpha.1] — 2026-05-19

First alpha of the v1.5 line. Three optimisation tracks landed since
v1.0.1, each independently verified against the production-deployed
service before this cut. Distribution tag `alpha` on npm — does NOT
move the `latest` pointer, so `npx capsulemcp` continues to resolve
to the stable v1.0.1 unless callers opt in with `npx capsulemcp@alpha`
or pin the explicit version.

Headline numbers:

- 5 new batched-write tools (`batch_*`) — 5–10× speedup on multi-
  record write flows
- 16 dictionary endpoints now cached per-instance with a 5-min TTL —
  measured 30× speedup on cache hits, ~150 ms → ~5 ms
- 4 `get_*` batch-fetch tools widened from 10 → 50 ids with
  transparent fan-out — 3–5× speedup on "filter + fetch detail"
  flows
- Structured `cache.*` and `batch.complete` events for retroactive
  log analysis (gcloud recipes in OPTIMIZATIONS.md)

Full feature list below.

### Added

- **`get_*` batch-fetch tools now accept up to 50 ids** (`get_parties`,
  `get_opportunities`, `get_projects`, `get_tasks`). Capsule's native
  multi-id GET caps at 10 per request, so for 11–50 ids the
  connector transparently splits into 10-id chunks and fans out the
  Capsule calls in parallel using `Promise.all` (max 5 chunks per
  tool call). Caller-facing tool surface is unchanged — same return
  shape, same arguments, just a higher `max`. Speeds up the common
  "filter returned N parties, now fetch their full records" pattern
  by 3–5× when N > 10. Adds a small `chunk<T>(arr, size)` helper to
  `src/capsule/batch.ts`; 6 new tests cover the chunk helper plus
  the >10 fan-out path in `tests/parties.test.ts` (representative
  for all 4 tools — they share the same code shape). 407 total tests.
- **Five batched-write tools** (`src/capsule/batch.ts` + per-tool
  wrappers): `batch_update_party`, `batch_update_opportunity`,
  `batch_complete_task`, `batch_add_tag`, `batch_remove_tag_by_id`.
  Each accepts an `items` array (1–50) and fans out parallel HTTP
  requests to Capsule with a default concurrency cap of 5
  (configurable via `CAPSULE_MCP_BATCH_CONCURRENCY`, clamped to
  `[1, 50]`). Returns `{ results: [{ ok, ...} per item], summary:
  { total, succeeded, failed } }`. Use case: LLM flows that touch
  many records homogeneously — "tag these 20 contacts as RSAC26",
  "mark these 15 tasks done", "move this milestone batch to Won".
  Sequential N × ~400 ms collapses to one tool call ≈ wire trip +
  ⌈N/concurrency⌉ × Capsule round-trip, typically ~8× faster for a
  10-item batch. Capsule has no rollback, so partial failures are
  visible per-item in the result array — designed for the LLM to
  read and react. Each item routes through the same single-tool
  function as the non-batch variant, preserving idempotency
  semantics. Catalogue grows 81 → 86; read-only count unchanged at
  49. Bundle: `dist/index.js` 123 → 131 KB, `dist/http.js`
  148 → 156 KB. 18 new tests in `tests/batch.test.ts`. Always emits
  a `batch.complete` event to stderr (regardless of
  `CAPSULE_MCP_LOG_VERBOSE`) with low-cardinality summary fields
  (total, succeeded, failed, durationMs, concurrency). Detailed,
  deduplicated `failureReasons` are included only when
  `CAPSULE_MCP_LOG_VERBOSE=1`, because Capsule error messages can
  contain CRM data. See OPTIMIZATIONS.md "§2 / How to verify" for
  recipes. Deferred batch variants (`batch_create_*`,
  `batch_delete_*`, batch task/project/entry/note/track) listed in
  IDEAS.md.

### Changed

- **Verbose cache logging for retroactive analysis** (`src/log.ts`).
  New `CAPSULE_MCP_LOG_VERBOSE=1` env emits single-line JSON events
  to stderr for every cache operation — `cache.hit` (with `ageMs`),
  `cache.miss` (with `reason: empty | expired` and Capsule
  `latencyMs`), `cache.invalidate` (with `trigger` label and
  `droppedCount`), and `cache.evict` (capacity overflow). Cloud Run's
  logging agent auto-parses these into `jsonPayload` fields so you
  can query hit rate, miss-reason distribution, Capsule latency p50/
  p99, eviction frequency, etc. retroactively via gcloud — recipes
  in OPTIMIZATIONS.md "Method B". Off by default (one log line per
  cache lookup is real volume); flip on for measurement windows
  only. 12 new tests in `tests/log.test.ts`.
- **Per-instance TTL cache for near-static reference data**
  (`src/capsule/cache.ts`). Sixteen dictionary-style endpoints —
  pipelines, milestones, boards, stages, custom-field schemas, loss
  reasons, activity types, categories, goals, teams, users, track
  definitions, saved filters, tags, and `get_site` — are now served
  from a per-process `Map` cache for up to 5 minutes (default).
  LLM-driven conversations that loop "discover ids → call write
  tool" repeatedly cost one Capsule round trip per dictionary per
  TTL window instead of N. Measured impact on write-heavy flows:
  30–50% fewer Capsule API calls; cached reads drop from ~150ms to
  ~1ms. Record-level reads (parties, opportunities, projects, tasks,
  entries) are deliberately uncached — those are the data that
  actually changes during a conversation. `get_current_user` is also
  uncached so it never lags a token rotation. `add_tag` and
  `remove_tag_by_id` invalidate the relevant cached `list_tags`
  entry so the catalogue stays coherent within a single client
  session. Two env knobs: `CAPSULE_MCP_CACHE_DISABLED=1` (canonical
  on/off — unset means cache enabled) and `CAPSULE_MCP_CACHE_TTL_MS`
  (entry lifetime when enabled, default `300000`). Setting
  `TTL_MS=0` also disables as a back-compat shortcut. DESIGN.md L6
  reworded to
  reflect the new behaviour; new L13 documents the cache contract,
  staleness bounds, and per-instance scope. Adds ~2 KB to each
  bundle (`dist/index.js` 119 → 122 KB, `dist/http.js` 145 → 147 KB).

### Documented

- **New `OPTIMIZATIONS.md`** captures the cache work end-to-end:
  what was changed, design constraints, how to verify (Cloud Run
  log-driven latency comparison + A/B with the disable flag +
  unit tests), and the measured production result (mean
  166 ms → 5 ms, ~30× speedup, byte-identical correctness).
  Also documents the 4 planned optimisations (tool-catalog
  tiering, bundle minification, `min_instance_count=1`, CI
  parallelism) so we don't rediscover them later. Linked from
  README's "Pick your install" table.
- **4 more tool descriptions rewritten for richer LLM routing.** After
  v1.0.1 shipped, Glama's re-probe lifted all 15 previously rewritten
  tools to A but tightened its grading rubric and demoted 4 tools that
  were short A's (`get_party`, `get_opportunities`, `list_lostreasons`,
  `list_categories`) to B. Rewriting them to the same when-to-use +
  what-returns + compare-to-neighbours shape lifts them back to A,
  bringing the catalogue to 81/81 at A. No behaviour change; bundle
  size ticks `dist/index.js` 118 → 119 KB and `dist/http.js`
  144 → 145 KB.

## [1.0.1] — 2026-05-14

Post-1.0 hardening + LLM-routing polish. No behaviour change against
correct callers; just smaller attack surface and richer tool
descriptions.

### Security

- **GitHub Actions token permissions pinned to read-only.** CI only needs
  to fetch the repository, so the workflow now declares
  `permissions: contents: read` instead of inheriting repository/org
  defaults.
- **Party website URL validation tightened to an http(s) allow-list.**
  `service: "URL"` addresses already had syntax validation and blocked
  the obvious scriptable schemes; the schema now rejects every non-web
  protocol instead of relying on a deny-list. Affects `create_party`,
  `update_party`, and `add_party_website` — `ftp:`/`file:`/`mailto:`
  etc. previously passed; they now 422 at the schema layer. Web-only
  service URLs were always the intended use case (other social
  services like TWITTER/GITHUB have their own service types).

### Documented

- **15 tool descriptions rewritten for richer LLM routing.** All 5
  tools that Glama's introspection scored as C-grade
  (`list_party_opportunities`, `list_party_projects`,
  `create_opportunity`, `list_milestones`, `list_users`) and the
  10 B-grade tools (`get_opportunity`, `list_associated_projects`,
  `create_project`, `get_task`, `list_opportunity_entries`,
  `list_project_entries`, `list_pipelines`, `list_boards`,
  `list_activitytypes`, `list_tags`) now follow the
  what-it-does + when-to-use-it + what-it-returns + how-it-compares-
  to-related-tools shape the A-grade tools already had. No behaviour
  change — descriptions only affect LLM tool-selection. Bundle size
  grows accordingly: `dist/index.js` 115 → 118 KB, `dist/http.js`
  140 → 144 KB.
- **Glama MCP server badge added to the README.** Links to the
  third-party server-quality listing at
  <https://glama.ai/mcp/servers/soil-dev/capsulemcp>.
- **`glama.json` claim file** committed at repo root so the Glama
  maintainer flow can verify the listing belongs to this project.

## [1.0.0] — 2026-05-13

First stable release.

Promotes [1.0.0-beta.4] to GA — no code change vs. beta.4. From this
point on the project follows [Semantic Versioning](https://semver.org)
strictly: breaking changes require a major bump, new tools / env vars
get a minor bump, bug fixes and doc updates get patches. The two most
recent minor lines receive security backports.

The full feature set, surface area, and design rationale are unchanged
from beta.4 — see that section below for the substantive notes, and
[DESIGN.md](DESIGN.md) (L1..L12) for the known limitations the project
intentionally ships with.

## [1.0.0-beta.4] — 2026-05-13

Pre-1.0 security review pass. Three Sev-3 findings fixed in code,
two captured as documented limitations, plus the tooling/hygiene
work that accumulated since beta.3.

### Security

- **Per-request timeout now covers body consumption, not just
  headers.** `fetchWithTimeout` cleared its AbortController in the
  `finally` of the initial `fetch()` call, so the 60s budget only
  guarded headers + initial response. Subsequent `res.json()` /
  `res.arrayBuffer()` / streaming `body.getReader().read()` /
  `res.text()` calls ran un-timed — a Capsule response that returned
  headers promptly then stalled mid-body pinned the request
  indefinitely (realistic DoS vector: one such hang costs a Cloud
  Run instance). Fix: `fetchWithTimeout`/`doFetch` now return
  `{ res, cleanup }`; every top-level capsule client function calls
  `cleanup` in a try/finally wrapping body consumption, and a new
  `mapAbort()` helper converts mid-stream AbortError into the same
  clean `CapsuleApiError 504` a fetch-stage abort produces.
  Regression test in `tests/rate-limit.test.ts`.
- **`MCP_HTTP_TRUST_PROXY` env override added** (default `1`,
  validated as integer 0..10). Previously hardcoded — fine for
  single-frontend deployments (Cloud Run), wrong for multi-hop
  ingress (Cloudflare → Cloud Run needs `2`) and for bare-IP
  deployments without any proxy in front (where any
  `X-Forwarded-For` trust lets a client spoof their per-IP rate
  limit bucket). Authenticated `/mcp` is unaffected — the bearer
  auth runs first and the limiter keys by client_id, not IP.
- **URL validation on website `address` when `service` is `URL`.**
  Was `z.string().min(1)` with no further check; the connector
  would happily write `javascript:alert(1)` or `not a url` into
  Capsule's website field, and Capsule stores user-supplied strings
  verbatim. Two new gates via Zod `superRefine` on both
  `WebsiteSchema` (create/update party nested) and
  `addPartyWebsiteSchema`: (1) syntactic — must parse via WHATWG
  URL parser when service resolves to URL; (2) scheme —
  `javascript:` / `data:` / `vbscript:` rejected even when
  syntactically parseable. Non-URL services (TWITTER, BLUESKY,
  GITHUB, …) are untouched.
- **Constant-time PKCE verification.** The MCP SDK's bundled
  `pkce-challenge` does its verifier-vs-challenge compare with
  native `===`. Both sides are fixed-width SHA-256 base64url
  strings so there's no realistic information leak, but the SDK
  exposes an explicit `skipLocalPkceValidation` opt-out for
  exactly this concern. The OAuth provider now sets it and does
  the PKCE check itself: `base64url(SHA-256(verifier))` compared
  against the stored challenge via `timingSafeEqual`. The check
  runs before the resource-binding check, and a failed compare
  does NOT consume the code (so a network glitch on a legitimate
  exchange doesn't burn it).

### Documented (limitations)

- **DESIGN.md gains L11** (Capsule error bodies pass through to
  MCP responses verbatim — relevant for adversarial-tenant
  scenarios; same trust boundary as L1, sanitisation is a future-
  minor candidate) and **L12** (authorization-code state is
  in-process — multi-instance deployments without session affinity
  need sticky sessions or vertical scaling until auth-code state
  moves to a shared store; Cloud Run's single-instance affinity
  covers the worked example in DEPLOY.md).

### Tooling

- **Biome added as the project linter + formatter** (`biome.json`).
  Single binary replaces a notional ESLint+Prettier pair; config tuned
  to match the existing tree (spaces, 2-width, 100 cols, double quotes,
  trailing commas, semicolons) so the day-one diff is purely
  mechanical. `useLiteralKeys` disabled because the codebase
  intentionally uses `process.env["X"]` bracket access. New npm
  scripts: `lint`, `format`, `format:check`, `check`.
- **One-time `style:` sweep** (`biome format --write`) reformatted 49
  files. Pure formatting — 337 tests still pass, both bundles unchanged
  in size.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) runs on every PR
  and push to master: typecheck, Biome lint + format check, tests,
  build, `npm audit --audit-level=high`. Concurrency group cancels
  superseded runs. Whole job completes in ~25s.
- **`CONTRIBUTING.md`** added — short pointer doc covering the
  pre-PR gate, coding-style rules (mostly: "let Biome handle it"), and
  where to look for deeper docs.
- **Repository hygiene additions**: `SECURITY.md` (private reporting
  channels, scope, 3-day-ack / 14-day-triage commitment),
  `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`
  (structured bug + feature forms; redirects security/install/API
  questions before they reach the tracker),
  `.github/PULL_REQUEST_TEMPLATE.md` (summary + what-changed +
  test-plan checklist), `.github/dependabot.yml` (weekly npm +
  github-actions version updates, minor/patch batched).
- **DESIGN.md gets an "At a glance" architecture diagram** showing
  both transports (stdio → `dist/index.js`, HTTP+OAuth →
  `dist/http.js`) converging on the shared tool surface and Capsule
  client; read-only gate and confirm-flag gate annotated.
- **`package.json` `bin` path normalised** (`./dist/index.js` →
  `dist/index.js`) per `npm pkg fix` to silence the publish-time
  warning.
- **Action versions bumped**: `actions/checkout` v4 → v6,
  `actions/setup-node` v4 → v6. CI now runs on Node 24 runtime
  instead of the deprecated Node 20.
- **Refactor scrub** (PR #24): consolidated repeated tool-description
  constants, shared `mockFetch` / `mockJson` / `mockBinary` test
  helpers in `tests/test-helpers.ts`.
- **Example-value scrub.** A handful of tool descriptions and test
  fixtures used the operator's real social handle and a real
  production-tenant user id/username plus production-looking party ids
  as illustrative values; replaced with synthetic `@acmeco`, `123456`,
  `"alice"` so every install ships with neutral examples.

### Fixed

- **Friendlier `confirm: true` rejection message on all 7 gated tools.**
  Zod's default error on `z.literal(true)` reads
  `"Invalid input: expected true"` — technically correct but unhelpful,
  especially for an LLM caller trying to self-correct (sounds like
  "you passed false" even when the field was missing entirely). New
  shared helper `confirmFlag()` in `src/tools/confirm-flag.ts` returns
  a `z.literal(true)` with a custom error message:
  `"confirm: true is required to perform this destructive operation
  (set the parameter explicitly to acknowledge the destructive intent)"`.
  Applied to `delete_party`, `delete_opportunity`, `delete_project`,
  `delete_task`, `delete_entry`, `remove_track`, and
  `remove_additional_party`. Per-tool `.describe(...)` text
  (cascade semantics, irreversibility/reversibility notes) is
  unchanged at each call site — only the rejection message is
  normalised. Regression coverage in
  `tests/confirm-flag.test.ts`: missing/false/true probes against
  each of the 7 schemas.
- **`create_opportunity.value.currency` missing-field error is now
  operator-readable.** Previously the schema emitted Zod's default
  `"Invalid input: expected string, received undefined"` when
  `value: { amount: N }` was supplied without `currency` — technically
  correct but unhelpful at a callsite. Custom `error` on the currency
  field now produces `"currency is required when amount is set
  (3-letter ISO 4217 code, e.g. 'USD', 'EUR', 'GBP')"` for the
  missing-field case specifically. Length and type errors still fall
  through to Zod's defaults so callers see exactly which constraint
  failed. Test coverage in `tests/opportunities.test.ts`.

### Documented

- **`remove_track` deletes the track's auto-tasks too.** §11
  production verification (2026-05-13) caught a stale claim in
  the `confirm` description: it said "Tasks already created by
  the track stay on the entity and must be deleted separately
  if desired." Wrong. Capsule deletes the auto-tasks alongside
  the track instance — verified isolated: apply track → 1 task
  alive (200), `DELETE /tracks/{T}` → 204, then GET on the
  same task id → 404 "task not found", and
  `GET /opportunities/{O}/tasks` returns 0. Description updated
  to spell this out and to suggest copying task content
  elsewhere if the operator needs anything to outlive the
  track. NOTES §25 (cascade on parent delete) stays accurate —
  it correctly says auto-tasks are cascaded with their parent
  opp/project; the new finding is just that the same happens
  on a direct `remove_track`.
- **`update_entry.subject` on plain notes is a true no-op, not
  audit noise.** §8 production verification (2026-05-13) showed
  that PUT-ing a subject onto a note-type entry returns HTTP 200
  but **neither persists the subject nor advances `updatedAt`**
  (verified with a 2-second gap to rule out timestamp-resolution
  collisions). The previous description claimed Capsule accepts
  the call and advances `updatedAt` — wrong, possibly stale from
  an older API behaviour. Updated to: true no-op for inapplicable
  fields; `updatedAt` only advances when an applicable field
  actually changes.
- **`create_task` description now covers the no-target case.** §4
  production verification confirmed Capsule accepts a task with no
  `partyId` / `opportunityId` / `projectId` (standalone task — useful
  for personal reminders or workflow tasks not tied to a CRM record).
  The previous description only spelled out the mutex; the no-target
  outcome was undocumented. Description now says "omitting all three
  is also valid" with the intended use case.
- **Address `country` field is dictionary-validated, not
  free-text.** §1 production verification showed that Capsule
  rejects inputs not in its canonical-English-name dictionary
  with `422 address.country: unknown country` — not silently
  passes them through. The previous description's
  "normalisation, not rejection" framing was wrong for any
  input that wasn't already a dictionary hit. Updated:
  - `AddressSchema.country` and `addPartyAddressSchema.country`
    descriptions now list the dictionary edges discovered
    (accepted, aliased, and notable rejections like
    `Czech Republic`, `UK`, `Deutschland`).
  - NOTES-ON-CAPSULE-API.md §30 documents the dictionary
    behaviour with the full probe table.
- **Capsule's v2 REST API does not expose team↔user membership.**
  Verified live on the production tenant by probing five
  plausible shapes (`GET /teams`, `embed=users`,
  `GET /teams/{id}`, `GET /teams/{id}/users`, `GET /users/{id}`)
  — all return identity but no join. NOTES §29 and the
  `list_teams` tool description carry the limitation
  explicitly, including the `update_project { ownerId, teamId } →
  422` membership-probe workaround.

## [1.0.0-beta.3] — 2026-05-11

Container-image-build fix. v1.0.0-beta.1 and v1.0.0-beta.2
**published successfully on npm/GitHub but their container-image
builds failed silently** — the production Cloud Run service has
been running the v1.0.0-alpha.20 image since the alpha.20 deploy,
despite the deployed service's `serverInfo.version` claiming
"beta.1" / "beta.2".

Root cause: PR #19 added `COPY scripts ./scripts` to the
Dockerfile so the container build could run the same
`npm run build` script as local builds (which chains
`build:icon`). But the matching `.dockerignore` entry for
`scripts/` was never removed, so the `COPY` step failed with
`no items matching glob "scripts"` — exit 125. The image build
GitHub workflow reported `conclusion: failure`, but the local
`gh run watch --exit-status | tail -3` invocation masked the
non-zero exit through the pipe, so the pre-deploy "wait for
build" step appeared to succeed. Cloud Run's `:latest` digest
hadn't moved since alpha.20, and Pulumi cheerfully resolved and
deployed that stale digest twice in a row.

This release bumps to beta.3 (the previous tags' content is
fine — only the container builds were stuck) and:

- Removes `scripts` from `.dockerignore` so `COPY scripts ./scripts`
  succeeds.
- HOWTO release checklist gains a "verify the workflow run's
  conclusion, not just exit status" line so the masking via
  `tail` can't recur.

No code changes. The behavioural improvements documented under
beta.1 and beta.2 **become actually live** with this release —
constant-time client_secret, /mcp rate limit, sanitized error
logs, stage carry, Zod token validation, stdio fail-fast.

## [1.0.0-beta.2] — 2026-05-11

Long-tail housekeeping after the beta.1 production verification
round. No behavioural changes; doc accuracy improvements on the
two outstanding Capsule-API observations from the alpha tail.

### Closed (long-tail housekeeping)

- **Bug 11 — `remove_tag_by_id` transient hang.** Observed once
  in early alpha and unreproducible since. The beta.1 stress
  loop ran **24 back-to-back `remove_tag_by_id` calls** on the
  same party (across three iterations of add-8-tags / read /
  remove-8-tags) with zero anomalies — no hangs, no timeouts,
  no errors, no latency outliers. Closed as unreproducible; the
  original observation is attributed to a transient upstream
  Capsule hiccup or the Claude.ai tool-approval prompt's own
  timeout firing higher up the stack, not a connector defect.
  The 60s outbound timeout in `src/capsule/client.ts` stays —
  it remains the right defence against real upstream slowness
  even though the original hangs weren't its target.

### Documented

- **BOOLEAN custom fields are observably two-state, not three-state.**
  The beta.1 production verification of Bug 12 confirmed Capsule
  still rejects `value: null` with 422 (as documented), AND added a
  new datapoint: `value: false` is accepted but the row is then
  **absent** on read-back via `embed='fields'`, not a row with
  `value: false`. Updated `CustomFieldWriteSchema.value` description
  and NOTES §21 to reflect: BOOLEAN states are "row with `true`" or
  "no row"; callers should treat absent BOOLEAN rows as equivalent
  to false; tri-state semantics aren't achievable through Capsule's
  API (the previously-mentioned `_delete: true` workaround doesn't
  help because `value: false` already produces the absent-row state).

## [1.0.0-beta.1] — 2026-05-11

First beta. Closes the 20-alpha test-plan loop with a
coordinated beta-readiness polish pass across four review
angles (schema-description vs handler, top-level docs vs code,
test hygiene, and security) and the follow-up patches from
PR #20. No behavioural regressions; one new connector-layer
protection (per-client rate limit on `/mcp`), three new
defence-in-depth hardenings, three latent fixes uncovered by
review (async-store-safe `/token` precheck, public-DCR-client
passthrough, broader `update_project` stage carry), and a
thorough schema-description / docs sync.

### Added

- **Per-client rate limit on `/mcp`.** Keyed by authenticated
  `clientId` (falls back to IP). Default 600 requests per 60s,
  configurable via `MCP_HTTP_RATE_LIMIT_MAX` /
  `MCP_HTTP_RATE_LIMIT_WINDOW_MS`, disable-able via
  `MCP_HTTP_RATE_LIMIT_DISABLED=1` for tests. Backstop against
  one abusive caller exhausting the shared Capsule 4000-rph
  quota for everyone else on the same deployment.
- **`MCP_HTTP_DEBUG=1`** env var: opts in to verbose `/mcp`
  error logging. Default is now a low-cardinality summary
  (`ErrorName status`), to avoid Capsule response bodies (party
  names, validation messages) smearing across log aggregators.

### Fixed

- **Constant-time `client_secret` comparison on `/token`.** The
  MCP SDK's auth router uses native `!==` for client-secret
  validation, leaking a timing channel. Added an explicit
  pre-check middleware on `/token` that compares fixed-width
  digests with `timingSafeEqual` before delegating; the SDK's
  downstream compare now only ever runs on a known-valid
  secret-bearing client, while public DCR clients still flow
  through the SDK's standards path.
- **Stdio entry fails fast on missing `CAPSULE_API_TOKEN`.**
  Matches the HTTP entry's behaviour. The error used to surface
  only on the first tool call.
- **`verifyToken` runtime-validates the claims payload (Zod).**
  HMAC verification already prevents forgery, but Zod-validating
  the parsed JSON guards against future signing-key compromise
  / downgrade scenarios where a malformed claim (missing
  `expiresAt`, non-string `clientId`) would otherwise propagate
  into downstream `AuthInfo`.
- **`update_project` RMW now carries `stage` forward too.** When the
  caller supplies `ownerId` and omits `teamId` and/or `stageId`,
  the connector reads the current project for the RMW and carries
  omitted fields forward; alpha.20 only captured `team` from that
  read, but the same Capsule PUT semantic that would clear an
  absent `team` could plausibly clear an absent `stage` too (it
  was never directly tested either way). One extra integer in the
  body, no extra HTTP call when a RMW is already needed, defensive
  against a silent stage-clear regression. Explicit `stageId` on
  the same call still wins — the RMW only fills in `stage` when
  the caller didn't supply one.

### Changed

- **`src/tools/_custom-fields.ts` renamed to
  `custom-field-helpers.ts`.** The underscore-prefix convention
  was idiosyncratic and read as "private/scratch" to newcomers
  despite the documented sort-ordering intent. Imports updated
  in the three call sites; no behavioural change.

### Documented

- **`update_project.ownerId` description** now mentions that the
  RMW carries any omitted team/stage field forward, not just team.
- **`update_project.stageId` description** dropped the stale
  owner-clearing warning (the alpha.18-era observation that
  drove it couldn't be reproduced).
- **`apply_track.startDate` schema** now enforces the
  YYYY-MM-DD regex the description already promised (the schema
  was previously unconstrained `z.string()`).
- **`apply_track.entity` enum** comment reconciled with the
  schema: tracks are only exposed for opportunities and projects
  (parties remain unexposed, even though Capsule's API would
  accept them).
- **Operator-facing `add_note` descriptions** dropped the
  alpha.8 → alpha.13 `creatorId` history; reframed as "this
  parameter would enable audit-attribution spoofing on
  shared-connector deployments, so it is intentionally not
  exposed."
- **NOTES-ON-CAPSULE-API.md** last-sync date bumped; stale
  `Bug N` references in source comments removed (the section
  numbers in NOTES are canonical now).
- **IDEAS.md** Bug 17 framing on the `teamId` entry updated to
  reflect the alpha.19R reclassification (was tenant board
  automation, not a Capsule API rule).
- **DESIGN.md** "Wrong-path errors" section dropped the
  `v0.5.0`/`v0.5.1` version anchors (those releases don't
  exist in public history).
- **DEPLOY.md env-var table** now lists `MCP_HTTP_JSON_LIMIT`,
  the three new `MCP_HTTP_RATE_LIMIT_*` knobs, and
  `MCP_HTTP_DEBUG`. New "Trust model — read before deploying"
  subsection makes the shared-Capsule-identity model,
  unsanitized-data passthrough, and signing-key-rotation kill
  switch explicit.
- **HOWTO.md** pre-release checklist extended: README/INSTALL
  pin updates and README tool-count assertions added as
  explicit items (both have drifted before).
- **`CustomFieldWriteSchema.value`** description gains a one-line
  audit-log note: sending `value: null` on a field that's already
  empty is accepted but still bumps the parent entity's
  `updatedAt`. Read via `embed='fields'` first if `updatedAt` is
  being used as a "last meaningful change" signal. Closes a §12
  audit-noise observation that hadn't made it into the schema
  text.

## [1.0.0-alpha.20] — 2026-05-11

The alpha.19-R re-verification against the production tenant
with **board automations disabled** materially recasts four
releases worth of project-ownership findings. The bulk of what
we'd been treating as Capsule API quirks (Bug 17, the
"board-default team" behaviour, the create-time owner-drop on
`ownerId + stageId`) were tenant-specific board automation
rules, not Capsule API behaviours. Capsule's API itself
preserves whatever you POST.

### Fixed

- **#16: registerTool now uses the SDK config-form
  `server.registerTool({ inputSchema })` instead of the
  deprecated `server.tool(name, desc, schema.shape, ...)`
  overload.** The old path rebuilt `z.object(schema.shape)`
  internally and dropped object-level refinements
  (`superRefine`, whole-object `refine`). Today there are no
  such refinements in the codebase, but the bug would have
  silently re-emerged the moment one was added. Architectural
  hygiene fix.

### Reverted

- **#14 schema-level rejection of `create_project { ownerId,
  stageId }` rolled back.** The rejection was based on Bug 17,
  which we now know was board automation in the test tenant.
  Capsule's API preserves both fields cleanly when the
  automation is off. Generic connectors shouldn't bake in
  tenant-specific automation assumptions, so the `superRefine`
  is gone. Issue #14 reopened-and-reclosed with an explanatory
  comment.

### Documented

- **NOTES §27 rewritten (sixth pass).** The "Rule B (POST
  drops owner)" framing is struck — it was automation, not the
  API. Rule A (PUT owner-in-body clears team) stays, and the
  RMW that mitigates it stays. A new "tenant board automation"
  paragraph spells out the failure mode (board automations can
  mutate owner/team independently of the API, indistinguishable
  from an API quirk from the caller's perspective). Wrong-
  framings list extended with the alpha.{17,18,19} Bug 17
  framings.
- **NOTES §28 corrected.** Projects default to **API-token
  owner**, same as the other entity types — not `null` as
  earlier versions of this file claimed. The "null" reading was
  an automation artifact.
- **`create_project.ownerId` / `teamId` / `stageId`** descriptions
  rewritten to drop the Bug-17-era warnings and replace them
  with a "tenant board automation may mutate these fields on
  creation" caveat. Soft-pedal rather than claim an API rule
  the API doesn't actually have.
- **`update_project.stageId`** description (already corrected
  in the previous batch after alpha.19 verification) stays —
  the runtime behaviour it describes (owner preserved across
  stage-only PUTs) is real, not automation-dependent.

## [1.0.0-alpha.19] — 2026-05-11

Two strands of work since alpha.18:

### Fixed

- **Issue #14: `create_project { ownerId, stageId }` rejected at
  schema level.** Capsule's POST silently drops `ownerId`
  whenever `stage` is in the body, producing a project with
  `owner: null` regardless of the caller's intent. The connector
  cannot work around this in a single call. The schema now
  rejects the combo with an actionable error pointing callers at
  the stage-first workflow (create with `stageId`, then
  `update_project { ownerId }`).
- **Issue #15: HTTP-date Retry-After test made deterministic.**
  The test relied on real timers + whole-second precision in
  `toUTCString()`, which could give `parseRetryAfter` a ≤0 delta
  and fall back to the 5s default — racing the 5s vitest timeout.
  Converted to fake timers + pinned system time (matches the
  pattern other rate-limit tests already use). Same flake-class
  fix applied to the X-RateLimit-Reset test, which had the same
  real-timer + epoch-second-rounding race.

### Documented

- The alpha.18 schema descriptions claimed a "create without
  stageId, then update_project { stageId }" two-call workflow
  reaches owner+team+stage. **The update-with-stage leg actually
  clears the owner** — Capsule has a third clear rule beyond
  the two known in alpha.18:
  - **Rule B (PUT):** `stage` in body clears `owner`, regardless
    of whether `owner` is also in the body.
  - **Rule C (POST):** symmetric clear at create time (this is
    the original Bug 17).
  No connector-side fix exists for Rules B/C — Capsule's
  clearing is independent of body shape, so RMW can't help.
- `create_project.stageId` and `update_project.stageId`
  descriptions rewritten around the working **stage-first,
  owner-second** workflow.
- `create_project.teamId` notes the
  `create_project { partyId, stageId, teamId }` → 422 case
  (Capsule appears to implicitly attach an owner and validate
  against the team).
- **NOTES-ON-CAPSULE-API.md §27** rewritten (fifth pass) around
  three rules (A, B, C) plus the working workflow. All five
  prior wrong framings listed explicitly for future readers.

## [1.0.0-alpha.18] — 2026-05-11

Follow-through on the alpha.17-verification report. Three
findings landed:

1. The asymmetric Capsule PUT semantic was misdiagnosed twice
   before — actually `owner`-in-body clears `team`, but
   `team`-in-body preserves `owner` (server-side). The alpha.17
   "pair-rewrite" framing was wrong.
2. Bug 17 is broader than first thought: Capsule's POST drops
   `owner` whenever `stage` is in the body, regardless of
   whether `teamId` is supplied. The previous workaround
   ("supply teamId explicitly") doesn't work.
3. Capsule rejects projects with both `owner` and `team` set to
   null — `422 kase: owner or team is required`.

### Fixed

- **Bug 16 (closed at the connector level).** `update_project`
  now does **read-modify-write** when the caller supplies
  `ownerId` without `teamId`: fetches the project's current
  `team` and includes it in the PUT body, so the
  Capsule-side "owner-in-body clears team" semantic no longer
  bites. Caller-visible behaviour: `update_project { ownerId }`
  preserves the existing team scope. Callers who want to clear
  team alongside an owner change pass `teamId: null`.

### Documented

- **Bug 17 reframed and given a working workaround.**
  `create_project.ownerId` and `create_project.stageId` now
  describe the two-call workflow: create without `stageId`
  (`create_project { ownerId, teamId }`), then
  `update_project { stageId }` afterwards. The previous "supply
  `teamId` alongside" advice was wrong.
- **Owner-or-team-required constraint** (422 on violation) noted
  on both `update_project.ownerId` and `update_project.teamId`,
  and §27.
- **Owner-must-be-member-of-team constraint** (422 on violation)
  noted on `update_project.teamId` description.
- **NOTES-ON-CAPSULE-API.md §27** rewritten (fourth pass) around
  the actual asymmetric PUT semantic + the
  always-owner-or-team-required constraint + the connector's
  RMW shim. Earlier three wrong framings are explicitly listed
  in the section so future readers don't get confused by
  alpha.{16,17}-era commits.

## [1.0.0-alpha.17] — 2026-05-11

Project-ownership write surface fix. The §15-supplementary
production verification re-diagnosed Bugs 16 and 17 (the
alpha.16 framing was wrong) and identified the underlying rule:
Capsule's PUT on /kases rewrites the (owner, team) pair
atomically — the absent half is cleared. The connector now
exposes `teamId` and explicit `null` unassign so callers can
express every reachable shape.

### Added

- **`teamId` parameter on `create_project` and `update_project`.**
  Maps to Capsule's body shape `team: {id: teamId}`. Discover IDs
  via `list_teams`. Unblocks the USER+TEAM project-ownership
  workflow that the connector previously couldn't express.
- **Explicit unassign via `null` on `update_project.ownerId` and
  `update_project.teamId`.** Passing `null` sends `owner: null` /
  `team: null` in the PUT body — matches Capsule's web UI
  "Unassign" dropdown option. Passing `undefined` (omitting the
  field) continues to mean "don't touch this field in the body".

### Fixed (via the new `teamId` parameter)

- **Bug 16 (corrected) — `update_project { ownerId }` clears
  `team`.** Root cause re-diagnosed via the §15-supplementary
  production verification: Capsule's PUT on /kases treats an
  absent `team` field in the request body as "clear team to
  null", **not** "leave unchanged" — regardless of any
  compatibility between the new owner and the existing team. The
  alpha.16 framing ("team must be one the owner belongs to or it
  clears") was wrong. Fix: callers can now supply both `ownerId`
  and `teamId` on the same update to preserve (or change) team
  scope across an owner change. The symmetric case (`teamId`
  clearing owner) is documented on `update_project.teamId`.
- **Bug 17 (NEW) — `create_project { ownerId, stageId }` silently
  drops `ownerId` when the stage's board has a default team.**
  Connector forwards `ownerId` correctly — Capsule's POST
  resolves the conflict in favour of the board's default team.
  Fix: supply `ownerId` and `teamId` explicitly to land at
  owner+team in one call.

### Documented

- **NOTES-ON-CAPSULE-API.md §27** rewritten (third pass) around
  the actual write semantics: (Rule A) PUT treats absent
  owner/team as "clear", and (Rule B) POST drops owner when
  board-default team wins. Previous framings — "mutually
  exclusive" (initial) and "team must be one the owner belongs
  to" (alpha.16) — both wrong, explicitly flagged in §27 for
  future readers.
- IDEAS.md "Explicit `teamId` on write tools" entry updated to
  reflect partial implementation (projects only); parties /
  opportunities / tasks still deferred.

## [1.0.0-alpha.16] — 2026-05-11

Closes the §15-16 final batch of the production write-mode test
plan. One new bug (Bug 16, ownerId-clears-team on projects) +
several per-entity ownerId-default documentation gaps; both
description-only fixes per the report's recommendations.

**The 16-section production test plan is now fully run.** Final
tally: 16 numbered bugs across the series, **14 resolved**, 2
documented as Capsule API limits with workarounds (Bug 12 BOOLEAN
null-clearing, Bug 16 owner/team mutual exclusivity on projects).

### Documented

- **Bug 16** — setting `ownerId` on a project can silently clear
  its team membership. The behaviour is a consequence of Capsule's
  actual data-model rule: a project can have **owner alone**,
  **team alone**, or **owner + team where the team is one the
  owner belongs to** (users can be in multiple teams, so this is
  expressible whenever the operator has organised users into teams
  sensibly). What's NOT allowed is owner+team where the owner
  isn't in that team; Capsule resolves writes that would create
  that state by clearing the team rather than rejecting the
  request. The §15 production verification observed this when
  setting an owner who wasn't in the project's current team
  (initial bug report framed the rule as "owner and team are
  mutually exclusive" — that framing was wrong; the actual rule is
  "team must be one the owner belongs to"). The connector can't
  set `teamId` directly, so once a team is cleared, restoring it
  requires Capsule's web UI. Documented in verbose detail on both
  `create_project.ownerId` and `update_project.ownerId`, plus a
  new section in `NOTES-ON-CAPSULE-API.md` (§27).
- Per-entity **`ownerId` default inconsistency** documented on
  every `create_*.ownerId` description:
  - `create_party.ownerId`, `create_opportunity.ownerId`,
    `create_task.ownerId` default to the API-token owner when
    omitted.
  - `create_project.ownerId` defaults to **null** (Capsule lets
    the board's default team populate the `team` field instead).
  - **Opportunities do NOT inherit owner from the linked party** —
    surprising behaviour worth calling out separately on
    `create_opportunity.ownerId`. Also captured as
    `NOTES-ON-CAPSULE-API.md` §28.
- **Owner cannot be cleared via the connector**: once an `ownerId`
  is set on any entity, this connector has no path back to null
  (the schema rejects `0`, no `null` provision). Capsule's web UI
  is the only path. Documented on every `ownerId` field.

These close the §15-16 batch of the production write-mode test
plan. **The 16-section test plan is now fully run.** Final
tally: 16 numbered bugs filed across all 16 sections, **14
resolved**, 2 open (Bug 12 BOOLEAN-null clearing and Bug 16
owner/team mutual exclusivity — both documented as Capsule API
limits with workarounds). NOTES-ON-CAPSULE-API.md grows to 28
sections.

## [1.0.0-alpha.15] — 2026-05-11

Docs-only alpha. Three commits since alpha.14, none touching
runtime behaviour:
  a8b5091  §13-14 verification follow-through: `delete_party`
           track-orphan caveat + atomic-remove confirm-gate
           policy on 5 tools.
  88c8cde  NOTES-ON-CAPSULE-API.md grows from 18 → 26 sections,
           cataloguing 8 Capsule v2 quirks surfaced through the
           alpha series.
  f5173cf  Sanitize operator-specific references in public docs
           and code (production tenant tag names / id numbers /
           personal names that had leaked into CHANGELOG, NOTES,
           IDEAS, and a handful of test files and public tool
           descriptions).

### Changed

- `delete_party` description now documents the **track-instance
  orphan quirk** surfaced in the §13 cascade audit: track instances
  applied to cascaded opportunities/projects are NOT cleaned up by
  Capsule when the parent party is deleted — they survive as
  unreachable-from-normal-navigation records, only findable by
  track id via `show_track`. Callers who care about orphan
  accumulation should `remove_track` explicitly before
  `delete_party`. Document-only fix (recommendation option 1 from
  the §13 report); a connector-side pre-cascade is overkill for a
  low-impact quirk.
- The five atomic `remove_*_by_id` tools (email/phone/address/website
  /tag) now spell out the "atomic + reversible = no confirm gate"
  policy in their descriptions, with a pointer to the matching
  `add_*` tool for re-attach. Closes the §14 documentation gap
  where callers saw seven destructive tools requiring `confirm:
  true` and five not, with no explanation of when each protection
  applies.

## [1.0.0-alpha.14] — 2026-05-11

### Security

- **Removed `add_note.creatorId`** (issue #11). The parameter let
  any caller with write access record a note attributed to an
  arbitrary Capsule user, not just the API-token owner. Combined
  with `entryAt` backdating and a shared-connector deployment
  (where the OAuth client secret might leak or multiple humans
  drive the same connector), this was a trivial audit-attribution
  spoofing surface. The use cases it was added for (historical
  imports, on-behalf-of automation) are real but niche; surfacing
  the override by default is the wrong trade-off. Removed from
  the schema entirely; `addNote` no longer reads or forwards
  `creatorId`. Notes are now always attributed to the API-token
  owner. The `add_note` schema and the tool description on the
  server registration both note the removal explicitly so any
  caller carrying old call shapes gets a clear breadcrumb.
- A future env-gated re-introduction (`CAPSULE_MCP_ALLOW_CREATOR_OVERRIDE=yes`)
  is parked in IDEAS.md for deployments that actually need the
  override and are willing to opt in explicitly.

### Tests

- The alpha.8 regression test for `creatorId → creator: {id}`
  mapping was replaced with a negative regression test confirming
  the schema drops the parameter (zod's default unknown-key
  behaviour) and that no `creator` field reaches Capsule's request
  body.

## [1.0.0-alpha.13] — 2026-05-11

Refactor-heavy alpha, no behaviour change. Sets up cleaner internals
on the path to v1.0.0 final.

### Changed

- `show_track` description corrected — alpha.12's text claimed the
  response carries the track's link to its trackDefinition, the
  entity it's applied to, and completion status. Capsule's GET
  `/tracks/{id}` actually returns a much smaller projection:
  `id`, `description`, `trackDateOn`, `direction`, and the array of
  `tasks` attached. Description now matches the runtime and points
  callers at `list_entity_tracks` for the entity-reference path and
  at the tasks' own statuses as the completion proxy. Drift caught
  in the alpha.12 verification.
- All 12 destructive tools (`delete_party`, `delete_opportunity`,
  `delete_project`, `delete_task`, `delete_entry`,
  `remove_additional_party`, `remove_track`, `remove_tag_by_id`,
  and the four `remove_party_*_by_id` tools) now document their
  `alreadyDeleted` / `alreadyRemoved` response fields in the
  schema descriptions. The behaviour shipped in alpha.12; the
  documentation gap was flagged in the alpha.12 verification with
  the same shape as the alpha.9 → alpha.10 follow-up on
  `add_additional_party.alreadyLinked`.
- Outbound HTTP timeout (alpha.12, commit ca25f87) description
  softened: the alpha.10 / alpha.11 transient hangs that prompted
  the work were most likely Claude.ai tool-approval timeouts
  higher up the stack, not Capsule slowness. The 60s timeout is
  still correct as defense in depth; the prose was the only thing
  wrong.

### Refactored (internal only — no behaviour change)

- **`CustomFieldWriteSchema` consolidated** into a shared
  `src/tools/_custom-fields.ts` module. Previously the zod shape
  and the `definitionId → {definition: {id}, value}` body mapping
  lived in three places (parties, opportunities, projects) and had
  begun to drift. One source now. Net −45 LOC.
- **Destructive-op idempotency helper** extracted to
  `src/capsule/idempotent.ts`. The catch-and-convert-to-success
  pattern shipped in alpha.12 was duplicated in 11 handlers
  across 7 files; each block was ~10 lines. The helper collapses
  each to a 3-line call. Two named predicates (`isCapsule404`,
  `isCapsuleTagNotFound`) make "what error is caught" more
  discoverable than the inline status + message-match checks
  were. Net −65 LOC.
- **`registerTool` helper** extracted to
  `src/server/register-tool.ts`. Each of the 80 read/write tools
  in `createCapsuleMcpServer()` was registered with the same
  8-line `server.tool(...)` wrapper pattern; collapsed to a
  single-line call. Two payoffs: (1) `src/server.ts` drops from
  1080 to 615 lines and the built bundles drop ~10 KB each,
  (2) the tool name and description now live on the same call,
  eliminating the "Edit collapses two adjacent string lines"
  footgun that had hit three times in the alpha series.
  `get_attachment` stays as a raw `server.tool` call: its handler
  shapes the response per Content-Type and can't use the helper's
  fixed JSON-stringify wrapper.

  A bigger refactor (splitting `src/server.ts` into 13 per-resource
  modules mirroring `src/tools/`) was considered and deferred —
  the main benefit there was bounding-edits-by-file, and that's
  largely achieved by the line-count shrink alone. The option
  stays open for post-1.0.

Numbers:
  - Tools: 81 (49 read-only) — unchanged
  - Tests: 292 / 292 — unchanged
  - Build: dist/index.js 116 → 104 KB, dist/http.js 136 → 124 KB
    (the `registerTool` extraction collapses 80 inlined wrappers
    into one shared helper)

## [1.0.0-alpha.12] — 2026-05-11

### Changed

- **Destructive-op idempotency unified across all 12 tools.** §12 of
  the production write-mode bug-report observed that delete/remove
  tools leaked Capsule's "doesn't exist / not attached" errors
  (404 / 422) to callers, breaking retry / undo / reconciliation
  loops that naturally re-issue these calls expecting them to be
  safe ("desired state: gone; current state: gone; → success"). The
  `add_additional_party` precedent showed the pattern; now applied
  uniformly:
  - **DELETE-shape ops** (`delete_party`, `delete_opportunity`,
    `delete_project`, `delete_task`, `delete_entry`,
    `remove_additional_party`, `remove_track`) catch
    `CapsuleApiError(404)` and return their normal success shape
    plus `alreadyDeleted: true` (for `delete_*`) or
    `alreadyRemoved: true` (for `remove_*`). Successful first-time
    deletes now also carry `alreadyDeleted: false` /
    `alreadyRemoved: false` so callers can distinguish.
  - **PUT-with-_delete ops on party child arrays**
    (`remove_party_email_address_by_id`,
    `remove_party_phone_number_by_id`,
    `remove_party_address_by_id`,
    `remove_party_website_by_id`) catch `CapsuleApiError(404)`
    and return `{removed: true, alreadyRemoved: true, partyId,
    <subId>}`. Success path still returns the Capsule party
    response merged with `{removed: true, alreadyRemoved: false}`.
  - **`remove_tag_by_id`** catches `CapsuleApiError(422)` with the
    specific message "tag not found to delete" (other 422s still
    surface) and returns the same shape with `alreadyRemoved: true`.
  - Errors with other status codes / messages still propagate
    unchanged.

  Closes the §12 class observation. Callers writing reconciliation
  loops or undo flows can now retry destructive ops freely.

### Fixed

- **Bug 13** — `apply_track.startDate` was silently ignored.
  Capsule's POST /tracks body field is `trackDateOn` (per Capsule's
  own example in our `NOTES-ON-CAPSULE-API.md` §2), not `startDate`.
  The connector accepted the parameter and forwarded it as
  `startDate`, which Capsule's API drops silently — the resulting
  track always landed at today's date and auto-tasks computed
  `dueOn` from today + the track's `daysAfter` offset, regardless
  of what the caller passed. Renamed the body field on the way out
  while keeping the user-facing parameter name `startDate` (more
  intuitive). Backdating tracks for historical records and
  scheduling tracks against future contract end-dates both work
  now. Caught in the §11-12 production write-mode verification.
- Outbound Capsule HTTP timeout (defense in depth). All outbound
  requests now carry a 60-second timeout via AbortController; an
  aborted request is converted to `CapsuleApiError(504)` with retry
  guidance. Bug 14 in the §11-12 report and Bug 11 from the alpha.10
  report were filed as transient hangs in `remove_tag_by_id` /
  `list_entity_tracks` and prompted this work; in retrospect those
  hangs were almost certainly higher up the stack — Claude.ai's
  tool-approval prompt timing out while the user was away, before
  the connector was ever invoked. The connector had no call to
  time out. So this fix doesn't address those specific reports, but
  it's still the right thing to ship: real Capsule slowness, DNS
  hiccups, TCP keepalive holes, and Capsule outages that return
  slowly all benefit from a bounded outbound budget. The
  `AbortError → CapsuleApiError(504)` regression test in
  `tests/rate-limit.test.ts` locks the conversion.

### Changed

- `apply_track` description now warns explicitly that the tool is
  **NOT idempotent**: applying the same trackDefinitionId twice
  creates two independent track instances and two sets of
  auto-tasks. To apply only once, call `list_entity_tracks` first
  and check for an existing instance with the same
  `trackDefinition.id`. Closes Bug 15 by documentation (option 1
  from the §11-12 verification report — idempotency-by-default is
  arguably wrong here, since applying the same track to start a new
  cycle is a legitimate workflow).
- `apply_track.startDate` description now explains the mechanic
  more fully: `startDate` is added to each task definition's
  `daysAfter` offset to compute its `dueOn`. Defaults to today.
- `list_entity_tracks` description now notes that some boards have
  stage-triggered automation that auto-applies tracks when an
  entity enters specific stages — tracks returned here may include
  BOTH manually-applied tracks AND auto-applied tracks from board
  rules. Compare `trackDefinition.id` against your application's
  `apply_track` call history to distinguish.

## [1.0.0-alpha.11] — 2026-05-11

### Changed

- Tag-write tool descriptions corrected after the alpha.10
  production verification proved two earlier assumptions wrong:
  - `add_tag.tagName`: previously said *"Names are case-sensitive
    and tenant-global."* Verified live that Capsule matches
    case-INSENSITIVELY ('VIP' and 'vip' attach the same tag,
    preserving the canonical casing from whichever variant was
    created first). Description and example updated.
  - `remove_tag_by_id.tagId`: previously warned the parameter was
    the "per-entity LINK id, NOT the global tag id from list_tags".
    Verified live that the two are the same id — both sources work.
    Warning softened to a recommendation: read via `embed=tags`
    first because it confirms the tag is actually attached to the
    entity (a list_tags id for a tag NOT on this entity would 422
    'tag not found to delete').
  - File-header comment in `src/tools/tags.ts` rewritten to
    reflect the verified single-id model.
- Custom-field `fields[].value` descriptions now document three
  additional quirks surfaced during alpha.10 production
  verification:
  - **BOOLEAN cannot be cleared via `value: null`** — Capsule
    returns 422 'invalid type for field'. The other four observed
    types (TEXT, NUMBER, DATE, LIST) accept null cleanly and
    remove the row. Set BOOLEAN to `false` instead; the connector
    does not currently rewrite null → `_delete: true` for BOOLEAN
    because the workaround is trivial and tri-state booleans are
    rarely needed. (Bug 12 in the alpha.10 verification — closed
    by documentation per the report's recommendation.)
  - **NUMBER returned as string** — setting `value: 3` stores
    correctly, but the read-back via `embed=fields` returns
    `value: "3"` (string). Callers comparing values must coerce.
  - **TEXT empty-string clears the field** — `value: ""` has the
    same observable effect as `value: null`; empty-string and
    never-set are indistinguishable in Capsule's storage.
  - **Data-tag membership is implicit** — setting a custom field
    whose definition lives under a data tag (Capsule's mechanism
    for gating a related set of fields, e.g. all contract-related
    fields under one data tag) populates the field row's internal
    tagId but does NOT auto-add the data tag to the entity's tags
    array. `add_tag` it explicitly if you want it visible via
    `embed=tags`. (Documented on `update_project.fields` only,
    where this is most relevant.)

### Documentation

- IDEAS.md gains an entry for tag-definition delete: the connector
  has no way to delete a tag *definition* tenant-wide, only to
  detach a tag from a specific entity. Empty-definition cleanup
  currently requires Capsule's web UI. Surfaced during alpha.10
  verification (two test tags stranded in the tenant).

## [1.0.0-alpha.10] — 2026-05-11

### Added

- **Tag writes — two new atomic tools** for attaching and detaching
  tags on parties, opportunities, and projects. Closes the largest
  open missing-capability gap from the production write-mode
  bug-report (§7). Generic with an `entity` discriminator
  (`parties` / `opportunities` / `kases`) so the surface stays
  compact: 2 tools, not 6 per-entity pairs.
  - `add_tag(entity, entityId, tagName)` — PUT with
    `{tags: [{name}]}`. Capsule resolves the name against the
    tenant's tag dictionary: matches an existing tag if one with
    that name exists, otherwise creates the tag and attaches it.
    Idempotent — re-attaching an already-attached tag is harmless.
  - `remove_tag_by_id(entity, entityId, tagId)` — PUT with
    `{tags: [{id, _delete: true}]}`. The `tagId` is the
    **per-entity tag LINK id** (from get_party / get_opportunity /
    get_project with `embed=tags`), NOT the global tag id from
    list_tags. The schema description spells this out — Capsule's
    docs are easy to mis-read here. The global tag persists in the
    tenant for other entities that share it.
- **Custom-field value writes** via a new optional `fields`
  parameter on `update_party`, `update_opportunity`, and
  `update_project`. Closes the second-largest gap from §7 (Lifecycle
  contract data lives entirely in custom fields). Shape:
  `fields: [{definitionId, value}]` where `value` is
  string / number / boolean / null. Partial update — only the
  definitions you list are touched; any field NOT in the array is
  left unchanged. The handler maps each entry to Capsule's
  `{definition: {id}, value}` body form. Discover definition IDs
  via the existing `list_custom_fields` tool; read current values
  via `get_*` with `embed=fields`. Pass `value: null` to attempt
  clearing (Capsule's docs don't explicitly document a clear shape;
  if null doesn't work for some field type we'll add an explicit
  `_delete: true` path in a followup).

12 new regression tests cover both write paths (5 for tags across
entities including schema-layer rejection of empty names and
unknown entities; 4 for custom fields covering the body-shape
mapping and type-union rejection on each of the three update tools).

Tool count goes 79 → 81; read-only count stays at 49 (both tag
write tools are gated by `if (!readOnly)` and `capsulePut` already
refuses writes when `CAPSULE_MCP_READONLY=1`).

## [1.0.0-alpha.9] — 2026-05-11

### Fixed

- `add_additional_party` is now actually idempotent. Tool description
  has claimed *"Idempotent — re-adding a linked party is harmless"*
  since v0.x, but Capsule's API responds with `422 party is already
  a contact for this opportunity` (or `... already related to this
  opportunity` if the target is the entity's main party) on a
  re-add. The handler now catches those two specific 422 messages
  and converts them to a success-shape result with the new
  `alreadyLinked: true` flag, so callers can re-add freely without
  arming their own retry-on-422 logic. Other 422s (validation
  failures unrelated to existing links) and all other error classes
  surface unchanged. Closes Bug 10 from the production write-mode
  bug-report (sections 5–10).

### Changed

- `delete_party` description now lists projects (kases) in the
  cascade and documents that deleting an ORGANISATION does NOT
  cascade-delete people linked to it via `organisationId` — those
  people survive as standalone records with their `organisation`
  field silently cleared to null. Caller-facing surprise eliminated
  for both common audit-trail and "what did I just delete" cases.
- `upload_attachment` schema descriptions now state the **25 MB
  per-attachment Capsule limit** explicitly, note the connector's
  ~35 MB inbound body budget (which leaves room for the base64
  expansion of a 25 MB binary), and warn that Capsule does NOT
  cross-check `filename` / `contentType` / actual-bytes consistency:
  a typo in either is accepted and the file is stored as labelled.

## [1.0.0-alpha.8] — 2026-05-11

Two follow-up commits on top of alpha.7, both surfaced by
continued production write-mode testing.

> **Bug 9 (alpha.7) — `remove_party_*_by_id` tools were
> non-functional.** All four atomic-remove tools shipped in
> alpha.7 sent `{id, _destroy: true}` (Rails convention) but
> Capsule's v2 API spells the flag `_delete: true`. Capsule
> silently ignored the destroy and returned 200 OK with the row
> still present. Anyone who used the remove tools on alpha.7
> believes they removed rows that are still there — worth a quick
> audit of any party touched via those tools (read the party,
> compare the current child-array state to expectations). Fixed
> in this alpha; verified via the updated unit tests.

### Added

- `update_opportunity.lostReasonId` (optional). Closes Bug 8 from
  the production write-mode bug report (sections 5–8): connector
  had no way to set the lost reason, so every connector-driven
  Lost-close left `lostReason: null` on the record. Discover
  reason IDs via the existing `list_lostreasons` tool. Capsule
  silently drops `lostReason` on non-Lost milestones, so it's safe
  to include on any update; only meaningful when closing to Lost.
- `add_note.entryAt` (optional ISO-8601 timestamp). Backdating
  support for historical-note imports (migrating from another CRM)
  and for logging meetings that happened earlier. Capsule preserves
  `entryAt` across subsequent `update_entry` calls — only
  `updatedAt` advances on edits. Schema validates the ISO-8601
  format pre-call.
- `add_note.creatorId` (optional user ID). On-behalf-of authoring:
  log a note attributed to a specific Capsule user rather than the
  API-token owner. Discover via `list_users`.

### Changed

- `update_opportunity.milestoneId` description rewritten to
  document the closing-milestone side effects (auto-set `closedOn`
  and `probability` to the milestone default; preserve
  `lastOpenMilestone`; symmetric reverse on reopen) AND to warn
  about cross-pipeline relocation: Capsule does NOT validate that
  the new milestone belongs to the opportunity's current pipeline,
  so passing a cross-pipeline ID silently relocates the opportunity
  and may leave `lastOpenMilestone` referencing a milestone in the
  previous pipeline. Closes Bug 6.
- `update_project.stageId` description gains the same
  cross-board-relocation warning: Capsule does not validate that
  the new stage belongs to the project's current board; team and
  other board-derived defaults are NOT updated to match the new
  board. Closes Bug 7.
- `create_opportunity.milestoneId` description now states
  explicitly that the milestone implicitly determines the pipeline
  (no separate `pipelineId` parameter).
- `update_opportunity` tool description notes that closed (Won /
  Lost) opportunities remain fully editable — Capsule does not
  enforce closed-record immutability. Same note on `update_project`
  for CLOSED projects.
- `add_note.content` description now states the content is treated
  as MARKDOWN (Capsule's web UI renders the markdown when
  displaying). Pass markdown source, not HTML.
- `update_entry.subject` description warns that on plain notes
  Capsule accepts the call (advances `updatedAt`) but doesn't store
  the subject — confusing if `updatedAt` is being used as a "last
  meaningful change" signal. Notes preserve `entryAt` across edits;
  use `entryAt` for "when did this happen" and `updatedAt` for
  "last touched".

### Fixed

- `remove_party_email_address_by_id`,
  `remove_party_phone_number_by_id`,
  `remove_party_address_by_id`, and
  `remove_party_website_by_id` were silently failing to remove
  rows in v1.0.0-alpha.7. Each tool sent a PUT with
  `{id, _destroy: true}` (the Rails-style field name), which
  Capsule silently ignores — the response was 200 OK with the row
  still present. The correct field name is `_delete: true` (Capsule
  uses Rails-ish `_<verb>` shape but spells it `_delete`, not
  `_destroy`). All four handlers now send `{id, _delete: true}`,
  and the unit tests' body-shape assertions are updated. The
  regression was caught by a production write-mode verification
  run against the alpha.7 deploy (Bug 9 in the verification
  report). Documented as `NOTES-ON-CAPSULE-API.md` §18 so the
  same trap doesn't catch the next person.

## [1.0.0-alpha.7] — 2026-05-10

Combines the previously-tagged-but-never-deployed alpha.6
(`/mcp` pre-auth DoS hardening, #9) with PR #10 (MCP standards
compliance — RFC 8707 resource indicators, Origin guard,
MCP-Protocol-Version guard, SDK 1.12 → 1.29) and the production
write-mode bug-report fixes (schema tightening + 8 new atomic
child-array tools).

> **Token-invalidation on deploy.** With PR #10 in, the OAuth
> provider now binds tokens to `<PUBLIC_BASE_URL>/mcp` via the
> `resource` claim. Tokens issued by earlier alphas don't carry
> the claim and will be rejected immediately after this deploy
> rolls. Anthropic's connector silently re-runs the OAuth dance
> once; users see no UI change. Effectively a forced rotation,
> equivalent to a `MCP_OAUTH_SIGNING_KEY` rotation.

### Added

- 8 new atomic child-array tools on parties, giving callers
  surgical control over the `emailAddresses`, `phoneNumbers`,
  `addresses`, and `websites` lists without the surprises of the
  bulk-array path on `update_party` (which is append-only by
  Capsule's PUT semantics):
  - `add_party_email_address`, `remove_party_email_address_by_id`
  - `add_party_phone_number`, `remove_party_phone_number_by_id`
  - `add_party_address`, `remove_party_address_by_id`
  - `add_party_website`, `remove_party_website_by_id`
  Each tool issues exactly one PUT to `/parties/{id}` with a single
  item — adds carry no `id`/`_delete` (Capsule appends), removes
  carry `{id, _delete: true}` (Capsule removes that specific row).
  *(As shipped in alpha.7 the remove tools sent `_destroy: true`
  instead, which Capsule silently ignores — fixed in the followup
  commit; see the Unreleased / Fixed entry above.)*
  No GET-then-PUT diff, no value-matching heuristic, no race
  window where concurrent edits could be silently dropped.
  "Replace one email" decomposes into
  `remove_party_email_address_by_id` + `add_party_email_address` —
  two atomic ops, both observable.
  Discover row IDs via the existing `get_party` tool (each entry
  in the child arrays carries its own `id`).
  Removes do NOT require `confirm: true` — losing one email row is
  reversible (re-add the value); only whole-record deletes
  (`delete_party`, `delete_opportunity`, ...) carry the confirm
  gate.
  Tool count goes 71 → 79; read-only count stays at 49 (these are
  all writes).

### Changed

- `update_party` description rewritten to point callers at the new
  atomic tools for surgical changes. The bulk arrays on
  `update_party` are kept for callers who want to add multiple
  items in a single round-trip; their descriptions explain the
  APPEND-ONLY semantic and link to the matching atomic tool by
  name (e.g. emailAddresses → "use add_party_email_address /
  remove_party_email_address_by_id").

### Fixed

- `update_party` (and `create_party`) child-array tools now
  document the append-only semantics. Capsule's `PUT /parties/{id}`
  treats `emailAddresses`, `phoneNumbers`, `addresses`, and
  `websites` as merge-not-replace: every item in the array is added
  on top of the existing list. Passing the same item twice creates
  a duplicate; passing `[]` is a silent no-op (does not clear and
  does not advance `updatedAt`). Removal requires Capsule's
  `_delete: true` shape, which this connector does not yet expose.
  The schema descriptions on each of the four arrays now state this
  explicitly so callers don't expect "set" semantics that don't
  exist. (Caller-facing fix only; the underlying behaviour is
  Capsule's. A real "replace" path will need either a
  `replaceArrays: true` opt-in flag, or dedicated add/remove tools.)
- `websites.service` is now a zod enum with Capsule's full set:
  `URL, SKYPE, TWITTER, LINKED_IN, FACEBOOK, XING, FEED,
  GOOGLE_PLUS, FLICKR, GITHUB, YOUTUBE, INSTAGRAM, PINTEREST,
  TIKTOK, THREADS, BLUESKY, SNAPCHAT`. Previously a free-form
  string, so typos like `PIGEON_POST` made it all the way to
  Capsule before being rejected with 422. Caught in production
  write-mode testing.
- `phoneNumbers[].number` rejects empty strings at the schema
  layer (`min(1)`), matching `emailAddresses[].address` behaviour.
  Capsule rejects `""` with `phoneNumber.number: number is
  required`; now caught pre-call.
- Task status enums in `update_task` and `list_tasks` no longer
  expose `PENDING`. Capsule rejects direct sets with `cannot set
  task status to PENDING` (the status is internal to the track
  machinery; only `OPEN` and `COMPLETED` are settable). The
  `update_task.status` description explains this and notes that
  setting `OPEN` on an already-open task is a true no-op.

### Changed

- `create_party` description rewritten to explain the silently-dropped
  cross-type fields: for `type='person'`, `name` is ignored
  (firstName/lastName are used); for `type='organisation'`,
  firstName/lastName/title/jobTitle are ignored (`name` is used).
  Also documents the misleading 404 when `organisationId` points
  at a non-organisation party (Capsule filters lookups by type).
- `update_opportunity.probability` description now warns that it
  cannot be set in the same call as a closing milestone (Won/Lost):
  Capsule processes the milestone change first, the opportunity
  becomes closed, then the probability update is rejected with 422
  `probability can be updated only for open opportunity`. To close,
  leave `probability` out — it auto-snaps to 100% (Won) / 0%
  (Lost). On open milestones, `probability` is a true override of
  the milestone default.

3 new regression tests (websites.service enum, phoneNumber.number
empty-string rejection, task-status PENDING rejection). 254 → 257
tests.

## [1.0.0-alpha.6] — 2026-05-10

### Security

- Authenticate `/mcp` requests **before** parsing the JSON body
  (#9). The 35 MB JSON body parser was previously installed as
  global middleware, which meant any unauthenticated caller could
  POST a 35 MB `Content-Type: application/json` body to `/mcp` and
  make Express buffer + parse it before bearer auth could reject
  the request. That's free DoS leverage. The parser now lives on
  the `POST /mcp` route chain, **after** `requireBearerAuth`, so
  malformed or oversized unauthenticated bodies get a 401
  immediately without any parsing work. The OAuth endpoints
  (`/authorize`, `/token`, `/register`) keep working because the
  MCP SDK installs its own per-endpoint parsers with default
  ~100 KB limits — those are unaffected. Regression test asserts
  POST /mcp with a malformed body and no bearer returns 401 (proves
  the parser doesn't run pre-auth — would otherwise return 400).

## [1.0.0-alpha.5] — 2026-05-10

### Fixed

- 429 retry now honours Capsule's actual rate-limit reset signal.
  Capsule does NOT use the standard `Retry-After` header — its
  response carries `X-RateLimit-Reset` (UTC epoch seconds) instead.
  Our retry path was reading `Retry-After` only, falling back to a
  5-second default on every 429 (since Capsule never sent it),
  which meant we'd hit Capsule again with an empty hourly quota
  and 429 immediately. New `parseRateLimitDelay()` reads
  `X-RateLimit-Reset` first, `Retry-After` second, defaults to 5s.
  Still clamped at 60s so a far-future reset (Capsule's bucket is
  hourly — reset can be 50 minutes out) doesn't block a Cloud Run
  request indefinitely. Added 4 regression tests covering the
  Capsule-specific path, header precedence, future-clamp, and
  past-reset edge cases. Documented as
  `NOTES-ON-CAPSULE-API.md` §17.

## [1.0.0-alpha.4] — 2026-05-10

### Added

- `create_project` and `update_project` now accept an optional
  `stageId` parameter. Capsule projects (kases) live on Boards with
  Stages (board columns); without this, every project created via
  the connector landed unassigned to any board, and there was no
  way to move a project across its lifecycle stages — which is most
  of what projects are for in the CRM. The body field name on the
  Capsule side is `stage: <integer>` (per Capsule's docs); the
  user-facing parameter follows our `<resource>Id` convention to
  match `partyId` / `ownerId`. Discover stage IDs via the existing
  `list_stages` tool.

  Stage implies board (each stage belongs to exactly one Board), so
  the schema deliberately exposes only `stageId` and not a separate
  `boardId` — picking the stage already picks the board. Caught by
  the same production write-mode dry run that surfaced the
  websites schema bug.

## [1.0.0-alpha.3] — 2026-05-10

### Fixed

- `create_party` / `update_party`: the `websites` schema declared
  the address field as `url` (with `format: "uri"`, required). Capsule
  rejects that with `422 website.address: address is required` — the
  v2 API names it `address` regardless of service type, because the
  value can be a URL (`service: "URL"`), a Twitter handle
  (`service: "TWITTER"`, e.g. `@acmeco`), an Instagram handle, etc.
  URL-validation here would also reject those non-URL values. Renamed
  the schema field `url` → `address`, dropped the `.url()` validator
  (a string is correct), and added regression tests that lock both
  the new name and the old shape's rejection. Caught by a production
  write-mode test against a production Capsule tenant.

### Changed

- `complete_task` description rewritten from "Mark a task as
  completed." (4 words, search-poor) to a longer form that surfaces
  via tool_search for queries like "mark task done", "finish task",
  "complete task". Functionally unchanged. Caught in the same
  production write-mode test — `tool_search` was returning
  `update_task`/`delete_task`/`create_task` for "task done" but not
  `complete_task`, so the tool was effectively undiscoverable.

## [1.0.0-alpha.2] — 2026-05-10

### Fixed

- Container failed to start on `node:20-slim`: undici 8.2.0 calls
  `webidl.util.markAsUncloneable` (used by its `CacheStorage`
  initializer), which only exists in Node ≥ 22. Bumped the runtime
  base image to `node:22-slim`, the tsup target to `node22`, and
  the `package.json` engines field to `>=22`. Caught by the
  `v1.0.0-alpha.1` deploy on Cloud Run — local dev was on Node 24
  so the issue never showed up in tests or the build. Exactly the
  class of bug a dry-run pre-release exists to catch.

## [1.0.0-alpha.1] — 2026-05-10

First pre-release candidate for v1.0.0. Tagged for dry-run testing
before the final tag. Identical content to what would otherwise be
v1.0.0; release notes are listed below.

### Stats

- 71 tools (49 in read-only mode). 236/236 tests passing across
  26 test files.

### Added

- `get_current_user` tool wraps `GET /users/current`. Earlier
  releases claimed (in DESIGN.md) that Capsule v2 had no
  authenticated-user endpoint and substituted `get_site` — that
  was a wrong-path error. The endpoint is `/users/current`, not
  the GitHub-style `/users/me`. Returns the user owning the PAT
  this connector is using; useful for audit and for confirming a
  token rotation moved ownership to the expected account.
- `NOTES-ON-CAPSULE-API.md` — reference doc cataloguing 16
  Capsule v2 quirks discovered during development, each with a
  verbatim quote from the relevant Capsule doc page (so the
  reference is a snapshot if Capsule's docs ever change). Linked
  from the README pointer table.

### Fixed

- `add_additional_party` was crashing with
  `SyntaxError: Unexpected end of JSON input` because Capsule
  returns 204 No Content on the link endpoint
  (`POST /<entity>/{id}/parties/{partyId}`) and `capsulePost` always
  called `res.json()`. New `capsulePostNoContent` helper handles the
  empty-body case; the tool now returns a synthetic
  `{linked: true, ...}` summary instead. Caught during the v1.0.0
  wire-trace.
- `apply_track` was sending `{trackDefinition: {id}}` in the request
  body, which Capsule rejects with 422 "track definition is required;
  field=definition". The correct field name is `definition`. The GET
  response uses `trackDefinition`, but the POST body uses
  `definition` — a Capsule API asymmetry. Verified live during the
  v1.0.0 functional sweep; sent + verified the fix end-to-end.
- `get_attachment` was comparing Content-Type with `===
  "application/json"`, which missed `application/json; charset=UTF-8`
  (a real shape Capsule returns). Now strips Content-Type parameters
  before comparing — JSON / XML / text-typed attachments correctly
  return decoded text instead of falling through to base64.
- `list_tasks` description claimed an "or due date" filter that
  didn't exist in the schema. Description rewritten to match the
  actual filters (status + ownerId).
- `OpportunityValueSchema.currency` was optional in zod but Capsule
  rejects `{amount}` without a currency (422). Currency is now
  required at the schema layer so the error surfaces before the HTTP
  call.
- `upload_attachment` silently accepted invalid base64 input
  (Node's tolerant decoder produced corrupt bytes that Capsule then
  stored). Now validates the input matches the base64 alphabet and
  has a length divisible by 4 before uploading.
- Reference-data tools (`list_teams`, `list_lostreasons`,
  `list_activitytypes`, `list_track_definitions`, `list_categories`,
  `list_goals`, `list_users`, `list_pipelines`, `list_milestones`,
  `list_boards`, `list_stages`, `list_tags`) now accept optional
  `page` / `perPage` and surface `nextPage` from the Link header.
  Default `perPage=100` (Capsule's max) so small accounts still get
  everything in one call. Previously a 51-team account would have
  silently capped at Capsule's 50-record default page size.
- HTTP transport: `app.set("trust proxy", 1)` is set before the
  SDK's `mcpAuthRouter`. Without it, `express-rate-limit` (used
  internally by the auth router on `/authorize`, `/token`, and
  `/register`) treats Cloud Run's `X-Forwarded-For` as a
  misconfiguration and can fail OAuth requests in any
  ingress-fronted deployment. Configurable via the `trustProxy`
  option on `createApp` for multi-hop setups. (Issue #4.)
- HTTP transport: protected-resource metadata is now published at
  the RFC 9728 path-suffixed location keyed on the actual MCP
  resource (`/.well-known/oauth-protected-resource/mcp`), not the
  bare `/.well-known/oauth-protected-resource`. The `/mcp` 401
  response also includes `resource_metadata=…` in
  `WWW-Authenticate` so generic OAuth/MCP clients can discover the
  metadata without baked-in knowledge of the server layout.
  (Issue #5.)
- HTTP transport: `resolveBaseConfig` and `selectMode` now validate
  env up front. `PUBLIC_BASE_URL` must parse as a URL and use
  `https://` (or `http://` on localhost / 127.0.0.1 / ::1) — every
  other scheme, including schemeless `localhost:3000`, is rejected
  at startup. Each `MCP_OAUTH_REDIRECT_URIS` entry is validated
  with `URL.canParse`. `PORT` must be an integer in 1..65535. Bad
  values produce clear startup errors instead of late stack traces
  or broken OAuth metadata. (Issues #6 + #7.)
- **Pre-1.0 security audit hardening (one pass over every line of
  the HTTP / OAuth / Capsule-client surface):**
  - `/mcp` 500 responses no longer echo the caught error message
    to the client. The full error is logged to stderr; the body
    is now `{"error":"internal_error"}` only. Closes a future
    leakage path where a Capsule API error body could surface
    upstream content into authenticated MCP responses.
  - OAuth refresh-token TTL shortened from 365 days to 30 days;
    access-token TTL shortened from 30 days to 1 day. Tokens are
    stateless HMAC blobs (no per-token revocation by design — Cloud
    Run instances must come and go without sharing state); the
    kill switch for a compromised token is rotating
    `MCP_OAUTH_SIGNING_KEY`, which invalidates EVERY outstanding
    token at once. The shorter window bounds the leak window.
  - In-memory authorization-code map is now hard-capped at 10 000
    entries (oldest dropped) and swept by a 60-second
    `setInterval` (in addition to the per-issue sweep), so a
    sustained `/authorize` flood that never proceeds to `/token`
    cannot exhaust process memory. The GC timer is `unref()`ed so
    it doesn't keep the event loop alive.
  - `MCP_OAUTH_INSECURE_AUTO_APPROVE` is now refused at startup
    when `PUBLIC_BASE_URL` is not a loopback host, unless the
    operator explicitly sets `MCP_OAUTH_I_KNOW_WHAT_IM_DOING=yes`.
    Open DCR + auto-approve was always documented as
    "private-network only" — now the runtime enforces it.
  - `CAPSULE_API_BASE_URL` overrides are now validated at first
    use: must be a parseable URL, must be `https://` (or `http://`
    on loopback). A typo'd or hostile env value previously sent
    the bearer token in the `Authorization` header to the
    misconfigured origin; now the override is rejected with a
    clear error and no HTTP call is made.
  - Attachment download (`get_attachment`) now caps the response
    BEFORE buffering the bytes. The `maxBytes` limit is plumbed
    into `capsuleGetBinary`, which (1) refuses to read the body
    at all if `Content-Length` exceeds the cap and (2) aborts
    streaming once accumulated bytes pass the cap. Previously
    `arrayBuffer()` consumed the full response before the size
    check ran — a malicious or buggy upstream sending 5 GB into
    a 5 MB cap would have buffered the lot.
  - Dead `FixedClientStore.verifyClientSecret` removed. The MCP
    SDK's auth router compares secrets internally; our
    constant-time helper was never wired in. The misleading
    "defence-in-depth" comment is gone with it.

### Changed

- HTTP entry's inbound JSON body limit defaulted to 1 MB; bumped to
  35 MB so `upload_attachment` can carry up to a 25 MB attachment
  base64-encoded. Override via `MCP_HTTP_JSON_LIMIT`.
- `list_tasks` now actually defaults `status` to `"OPEN"` — the
  description had said so since v0.1 but the code passed `undefined`
  and let Capsule pick.
- `create_project` now applies its `OPEN` status default in code
  (`?? "OPEN"`) instead of via zod's `.default()`, matching the
  pattern adopted for `list_tasks`. The output type stays
  consistent for direct callers.
- README description rewritten to reflect the v0.5.x and v0.6.0
  surface (attachments, tracks, saved filters, audit, batch fetches).
- `package.json` description and keywords filled out for npm /
  registry discoverability.
- HOWTO.md test count refreshed to match the current suite.
- tsup builds index.js and http.js as separate configs so the shebang
  banner only lands on the stdio entry. http.js is now invoked as
  `node dist/http.js` without the noise.
- HTTP entry's mode-selection and base-config validation extracted to
  `src/http/config.ts` with pure functions, unit-tested.
- Repository moved from `arapov/capsulemcp` to `soil-dev/capsulemcp`
  (org-owned). GitHub redirects keep the old URL working; in-repo
  references all point at the new canonical location.

### Added

- `tests/http-config.test.ts` covers `selectMode` and
  `resolveBaseConfig` across all expected env permutations.
- Pagination tests for the reference-data tools.
- Base64-validation regression tests for `upload_attachment`.
- `capsulePostNoContent` client helper for 204-returning POSTs
  (currently used only by `add_additional_party`; available for
  any future endpoint with the same shape).
- `scripts/wire-trace.ts` — pre-1.0 verification harness that
  invokes every write-side tool function against the live API,
  observes the actual HTTP requests our code emits via undici's
  diagnostic_channel, and cleans up. Caught two production bugs
  (`apply_track` field name, `add_additional_party` 204 handling)
  that mock-only tests would have missed. Documented in HOWTO.md.
- `tests/mcp-integration.test.ts` — drives a real `McpServer`
  through the MCP wire protocol via the SDK's in-memory transport
  pair, with `undici.fetch` mocked. Verifies tool name registration,
  read-only-mode gating, schema-validation propagation, error
  responses for unregistered tools, and the `get_attachment`
  content-type routing logic that lives in `server.ts` (not in
  the tool function).
- The stale `scripts/live-smoke.ts` was removed —
  `scripts/wire-trace.ts` covers everything it did and more (every
  write tool, including v0.4–v0.6 additions).
- HTTP-app factory extracted to `src/http/app.ts` (mirrors the
  earlier `src/http/config.ts` extraction). `src/http.ts` is now a
  thin entry that resolves config, builds the OAuth provider,
  invokes `createApp`, and listens.
- `tests/rate-limit.test.ts` (7 tests): retry-on-429 with both
  integer-seconds and HTTP-date Retry-After headers, infinite-loop
  prevention (gives up after one retry), 5-second default when
  Retry-After is missing, 60-second clamp on absurdly large values,
  pass-through of non-429 errors, no retry on 401.
- `tests/http-app.test.ts` (16 tests): `/.well-known/*` metadata
  shapes, DCR disabled in static-client mode (`POST /register` →
  404), bearer-required gates on `/mcp` (401 without bearer, 401 on
  forged token, 405 on GET/DELETE with valid bearer), `/authorize`
  redirect with code (and rejection for wrong client_id), `/token`
  invalid_client on wrong secret, icon endpoint content-type and
  cache headers.
- `tests/stdio-entry.test.ts` (4 tests): smoke for the npx-installed
  binary. Spawns `dist/index.js` as a child process, walks the
  initialize handshake, calls `tools/list`, asserts the
  read-only-mode catalogue. Catches regressions in the post-build
  bundle that no other test layer would see.
- `assets/icon.svg` is now genuinely the canonical source. New
  `scripts/build-icon.mjs` regenerates `src/icon.ts` from the SVG;
  `npm run build` chains it. The generated file carries a
  "do-not-edit" header. New `tests/icon-source.test.ts` fails CI if
  the SVG and TypeScript drift apart, so the hand-sync hazard is
  closed (briefly removed in an earlier commit, now restored
  properly).
- `AutoApproveOAuthProvider` removed entirely. It was a v0.2.0-era
  alias for `new OAuthProvider({clientsStore: new
  InMemoryClientsStore(), signingKey})`; with no external consumers
  yet (capsulemcp is a new project that pre-1.0 had no API
  stability promise), there's nothing to maintain compatibility
  with. Tests migrated to construct `OAuthProvider` directly via a
  small `autoApproveProvider()` helper.
- `MCP_SHARED_SECRET` env-var fallback for `MCP_OAUTH_SIGNING_KEY`
  removed. It was carrying compatibility for v0.1.0-era deployments
  that the only known operator had already migrated off long ago.
  Error message and DEPLOY.md table updated to drop the fallback
  reference.
- Dependency bumps via Dependabot security advisories:
  `express-rate-limit` 8.5.0 → 8.5.1, transitive `ip-address`
  10.1.0 → 10.2.0 (PR #1); `esbuild` 0.21 → 0.27/0.28 and `vitest`
  2.1 → 4.1.5 (PR #3, superseding the redundant PR #2).

Suite now 227/227 passing across 25 test files.

## [0.6.0] — 2026-05-10

### Added

- `get_attachment(id, maxSizeBytes?)` — download attachments. Returns
  MCP image content for `image/*` types (Claude can describe them
  natively); decoded text for `text/*` / `application/json` /
  `application/xml`; JSON metadata + base64 payload for other
  binaries. Files exceeding `maxSizeBytes` (default 5 MB, max 25 MB)
  return metadata only with `truncated: true`.
- `upload_attachment(filename, contentType, dataBase64, content?,
  partyId? | opportunityId? | projectId?)` — orchestrates Capsule's
  two-step upload-then-attach flow into a single tool call. Subject
  to `CAPSULE_MCP_READONLY` like other writes.
- `capsuleGetBinary` and `capsulePostBinary` client helpers.

### Notes

- Capsule's upload endpoint is **not** multipart — it's a raw POST
  with the file as the request body and three required headers
  (`Content-Type`, `Content-Length`, `X-Attachment-Filename`). The
  client helpers handle this wire format.
- Adding an attachment to an existing entry isn't supported in this
  release; `upload_attachment` always creates a new note.

### Stats

- 70 tools (48 in read-only mode). 145/145 tests passing.

## [0.5.2] — 2026-05-09

### Added

- `get_task(id)` — solo task fetch (filled the symmetry gap with
  `get_party` / `get_opportunity` / `get_project`).
- Batch fetchers (Capsule caps at 10 ids per call):
  `get_parties(ids)`, `get_opportunities(ids)`, `get_projects(ids)`,
  `get_tasks(ids)`.

### Notes

- Capsule v2 does not expose `GET /entries/{ids}` (returns 404), so
  no `get_entries` companion is added.

### Stats

- 68 tools (47 in read-only mode). 137/137 tests passing.

## [0.5.1] — 2026-05-09

A patch release filling endpoint coverage that should have been in
v0.5.0 but was dismissed during the docs crawl due to wrong-path
errors:

- `GET /opportunities/{id}/parties` (additional parties) — earlier
  tried `/additionalparties`.
- `GET /opportunities/{id}/kases` (associated projects) — earlier
  tried `/projects`.
- `GET /<entity>/fields/definitions` (custom field schema) — earlier
  tried `/customfields`.
- `GET /<entity>/{id}/tracks` and `GET /tracks/{id}` — earlier saw
  `GET /tracks` (global) return 405 and gave up too early; tracks
  are entity-scoped only.

### Added

- `list_additional_parties`, `add_additional_party`,
  `remove_additional_party`.
- `list_associated_projects` (opportunity → projects).
- `list_custom_fields(entity)`, `get_custom_field(entity, fieldId)`
  for custom-field schema enumeration.
- Track instances:
  `list_entity_tracks`, `show_track`, `apply_track`, `update_track`,
  `remove_track`.

### Stats

- 63 tools (42 in read-only mode). 130/130 tests passing.

## [0.5.0] — 2026-05-09

### Added

- Audit: `list_deleted_parties(since)`,
  `list_deleted_opportunities(since)`,
  `list_deleted_projects(since)`. The `since` parameter is required
  by Capsule. Responses include `restrictedParties`/etc. siblings for
  records the integration user can see were deleted but cannot read
  fully.
- Navigation: `list_employees(partyId)` — wraps
  `GET /parties/{id}/people`.
- Workflow metadata: `list_track_definitions`, `list_categories`,
  `list_goals`.
- Diagnostic: `get_site` — closest equivalent to a `/users/me`
  endpoint, which Capsule v2 doesn't expose.
- Write: `update_entry(id, content?, subject?)` — edit existing
  notes/entries. Subject to read-only gate.

### Stats

- 52 tools (36 in read-only mode). 114/114 tests passing.

## [0.4.0] — 2026-05-09

### Added

- Reference metadata: `list_teams`, `list_lostreasons`,
  `list_activitytypes`.
- Project workflow metadata: `list_boards`, `list_stages`.
- Global timeline feed: `list_entries` — the company-wide
  most-recent-first feed of every note, captured email, and
  completed-task record.
- Saved filters (the only Capsule-side path to sortable queries):
  `list_saved_filters(entity)`, `run_saved_filter(entity, id)`.

### Stats

- 43 tools (28 in read-only mode). 101/101 tests passing.

## [0.3.4] — 2026-05-07

### Changed

- `filter_*` tool descriptions corrected to use Capsule's filter-side
  field names (e.g. `lastContactedOn`, not `lastContactedAt`;
  `addedOn`, not `createdAt`). Capsule's filter API rejects the
  response field names with a 422.
- Added "common patterns" recipe blocks to `filter_parties` /
  `filter_opportunities` / `filter_projects` so Claude reaches for
  recency, tag, open/stale, and noise-filtering idioms naturally.

## [0.3.3] — 2026-05-07

### Added

- Structured filter tools: `filter_parties`, `filter_opportunities`,
  `filter_projects`. Wrap Capsule's
  `POST /<entity>/filters/results` with `{conditions: [...]}` body.
- `capsuleSearch` client helper for POST-based reads.

### Notes

- Capsule's ad-hoc filter endpoint does **not** support sort. Tool
  descriptions guide Claude to filter by a date condition and pick
  the highest id (Capsule numeric IDs are monotonic) for recency
  questions. For sortable queries, use saved filters (added in
  v0.4.0).

### Stats

- 35 tools (20 in read-only mode).

## [0.3.2] — 2026-05-07

### Added

- Connector icon: SVG served from `/icon.svg` and `/favicon.ico` on
  the HTTP entry, plus referenced from the MCP `serverInfo.icons`
  field.

## [0.3.1] — 2026-05-07

### Changed

- Documentation reorganisation: split into README, INSTALL, DEPLOY,
  HOWTO so each audience has a clear landing page.
- Code cleanups in the auth module surfaced by review.

## [0.3.0] — 2026-05-07

### Added

- Static-client OAuth mode (default for public deployments). One
  hard-coded client_id / client_secret recognised at startup; DCR
  disabled at the SDK level. The shared `client_secret` is the real
  auth boundary.

### Changed

- Open Dynamic Client Registration is now opt-in via
  `MCP_OAUTH_INSECURE_AUTO_APPROVE=1`. Public deployments default to
  the closed-client mode.
- Server refuses to start if neither OAuth mode is configured —
  the secure mode is the path of least resistance.

### Security

- Pre-v0.3.0 deployments allowed any caller to register a client and
  complete the OAuth dance. The auto-approve mode is now an explicit
  opt-in for local / private-network use.

## [0.2.0] — 2026-05-07

### Added

- HTTP transport with full OAuth 2.1: `/.well-known/*`, `/authorize`,
  `/token`, `/register`, plus the gated `/mcp` endpoint.
- HMAC-signed access + refresh tokens (stateless; tolerant of Cloud
  Run instance churn).
- `Dockerfile` and Cloud Run-friendly entry.

## [0.1.0] — 2026-05-07

First release. Covers parties, opportunities, projects, tasks,
timeline entries, pipelines, milestones, tags, users with read +
write tools. Stdio transport. Apache 2.0.
