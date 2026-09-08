# HOWTO

Task-oriented procedures for working on capsulemcp. Focused on the things you might actually need to do; if something common is missing, that's a doc bug.

## Run tests locally

```sh
git clone https://github.com/soil-dev/capsulemcp.git
cd capsulemcp
npm install
npm test
```

613 tests, all mocked — no Capsule API calls happen, no token needed. The suite has three layers:

- **Per-tool unit tests** (e.g. `tests/parties.test.ts`): import the tool function, mock `undici.fetch`, assert on the URL, method, body, and response handling. Most tests live here.
- **MCP-protocol integration tests** (`tests/mcp-integration.test.ts`): drive a real `McpServer` through the wire protocol via the SDK's in-memory transport pair, with `undici.fetch` still mocked. Catches the layer between "tool function works" and "MCP correctly registers and dispatches the tool". Includes the `get_attachment` content-type routing logic (which lives in `server.ts`, not the tool function).
- **Auth tests** (`tests/auth.test.ts`, `tests/http-config.test.ts`): cover OAuth token issuance/verification, mode selection, base config validation.

The split lets you run any one file in isolation without a heavy setup.

Watch mode while editing:

```sh
npm run test:watch
```

The full pre-PR gate (everything CI will check) is:

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # Biome lint
npm run format:check   # Biome format check (run `npm run format` to fix)
npm run build
npm test
```

All together they take well under a minute on a warm cache.
`.github/workflows/ci.yml` runs the same set plus
`npm audit --audit-level=high` on every PR. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the contributor-facing summary.

## Build

```sh
npm run build
```

Produces `dist/index.js` (stdio entry, ~183 KB, with `#!/usr/bin/env node` shebang and the executable bit set) and `dist/http.js` (HTTP entry, ~210 KB, no shebang). Each is fully self-contained — tsup runs as two separate configs so the stdio entry can be invoked directly via npx while the HTTP entry isn't a CLI. tsup target is Node 22 (undici 8 requires Node 22+ for the `webidl.util.markAsUncloneable` runtime API).

`npm run build` also chains `npm run build:icon` (`scripts/build-icon.mjs`), which regenerates `src/icon.ts` from the canonical `assets/icon.svg`. The TypeScript file is committed (so typecheck works without a build step) but is **generated** — edit the SVG, then run the build. A drift-guard test (`tests/icon-source.test.ts`) fails CI if the two ever fall out of sync.

## Run the stdio server locally

For testing the stdio path interactively (e.g. with [`mcp-inspector`](https://github.com/modelcontextprotocol/inspector)):

```sh
npm run build

CAPSULE_API_TOKEN=<your token> \
CAPSULE_MCP_READONLY=1 \
node dist/index.js
```

## Run the HTTP server locally

```sh
npm run build

CAPSULE_API_TOKEN=<your token> \
CAPSULE_MCP_READONLY=1 \
PUBLIC_BASE_URL=http://localhost:8080 \
MCP_OAUTH_SIGNING_KEY=$(openssl rand -hex 32) \
MCP_OAUTH_CLIENT_ID=local-test \
MCP_OAUTH_CLIENT_SECRET=$(openssl rand -hex 32) \
MCP_OAUTH_REDIRECT_URIS=http://localhost:9999/cb \
node dist/http.js
```

You can then walk the OAuth dance against `http://localhost:8080`. See [Smoke test a deployed instance](#smoke-test-a-deployed-instance) for a script that does it.

For dev with auto-rebuild, use `npm run dev` (tsup watch) in one terminal and re-run `node dist/http.js` in another whenever you want to pick up changes.

## Smoke test a deployed instance

Save this as `smoke.sh` and run it against any deployed capsulemcp:

```sh
#!/bin/sh
set -eu
URL="${URL:-https://your-deployment-url}"
CLIENT_ID="${CLIENT_ID:?set CLIENT_ID env var}"
CLIENT_SECRET="${CLIENT_SECRET:?set CLIENT_SECRET env var}"

# PKCE pair
VERIFIER=$(python3 -c "import secrets; print(secrets.token_urlsafe(64))")
CHALLENGE=$(python3 -c "
import base64, hashlib, sys
print(base64.urlsafe_b64encode(hashlib.sha256(sys.argv[1].encode()).digest()).rstrip(b'=').decode())
" "$VERIFIER")

# 1. Authorize → get a code
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' \
  "$URL/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=https://claude.ai/api/mcp/auth_callback&code_challenge=$CHALLENGE&code_challenge_method=S256&state=t1&resource=$URL/mcp")
CODE=$(python3 -c "
import sys
from urllib.parse import urlparse, parse_qs
print(parse_qs(urlparse(sys.argv[1]).query).get('code', [''])[0])
" "$LOC")

# 2. Exchange code for access token
ACCESS_TOKEN=$(curl -s -X POST "$URL/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "code_verifier=$VERIFIER" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "resource=$URL/mcp" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# 3. Call /mcp
curl -s -X POST "$URL/mcp" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_users","arguments":{}},"id":1}'
```

Run with:

```sh
URL=https://your.deployment.example \
CLIENT_ID=... \
CLIENT_SECRET=... \
sh smoke.sh
```

If you see `"users":` in the response, the full chain works.

## Wire-trace against a real Capsule tenant (pre-release verifier)

`scripts/wire-trace.ts` invokes **every write-side tool function** against your real Capsule tenant, end-to-end, observing the actual HTTP requests our code emits via Node's `node:diagnostics_channel`. Designed as a pre-release verifier: catches the class of bug where unit tests mock Capsule incorrectly (so the tool function passes against the wrong oracle) but Capsule itself rejects the wire format.

What it covers in one run:
- `create_party`, `update_party`, `delete_party`
- `create_opportunity`, `update_opportunity`, `delete_opportunity`
- `add_additional_party`, `remove_additional_party`
- `create_project`, `update_project`, `delete_project`
- `apply_track`, `update_track`, `remove_track`
- `create_task`, `update_task`, `complete_task`, `delete_task`
- `add_note`, `update_entry`, `delete_entry`
- `upload_attachment` (orchestrates the two-step upload + entry-create)

```sh
CAPSULE_API_TOKEN=<your token> npx tsx scripts/wire-trace.ts
```

Uses fresh throwaway records named `ZZZ-MCP-WIRE-TRACE-A` and `ZZZ-MCP-WIRE-TRACE-B`, plus dependent records keyed off them. **Cleans up on success.** On crash, the records may stay — search Capsule for `ZZZ-MCP-WIRE-TRACE` and delete manually if so.

> **Use a non-production tenant if possible.** The script makes real API calls. It's careful about cleanup but a crash in just the wrong place could leave stray records.

When it caught real bugs:
- v1.0.0 pre-release: caught `apply_track` sending `trackDefinition` instead of `definition` (Capsule API asymmetry — response uses `trackDefinition`, request uses `definition`).
- v1.0.0 pre-release: caught `add_additional_party` crashing on the empty-body 204 response that mock tests had been modelling as 200-with-JSON.

Run it before tagging any minor or major release. For patch releases, judgement call — usually the unit tests + the integration tests in `tests/mcp-integration.test.ts` are sufficient.

## Add a new tool

Tools live in `src/tools/<resource>.ts`. Pattern for a new read tool:

```ts
// src/tools/parties.ts (example — adding a hypothetical "count parties" tool)
export const countPartiesSchema = z.object({});

export async function countParties(_input: z.infer<typeof countPartiesSchema>) {
  const { data } = await capsuleGet<{ count: number }>("/parties/count");
  return data;
}
```

Register it in `src/server.ts`:

```ts
import { countPartiesSchema, countParties, ... } from "./tools/parties.js";
// ...
registerTool(
  server,
  "count_parties",
  "Return the total number of parties in the Capsule tenant.",
  countPartiesSchema,
  countParties,
);
```

Use the local `registerTool` helper for normal JSON-returning tools. It
passes the full Zod object schema to the MCP SDK; using
`server.tool(..., schema.shape, ...)` drops object-level refinements such
as `superRefine`.

For a write tool:

```ts
export const createSomethingSchema = z.object({
  name: z.string().min(1),
  // ...
});

export async function createSomething(input: z.infer<typeof createSomethingSchema>) {
  return capsulePost<{ thing: unknown }>("/things", { thing: input });
}
```

Register inside the `if (!readOnly)` block in `server.ts` so `CAPSULE_MCP_READONLY=1` correctly hides it.

For a delete tool, include `confirm: z.literal(true)` in the schema and check it in the handler — see any `delete_*` tool for the pattern. The schema-level gate prevents accidental destruction; never skip it.

Add a unit test in `tests/<resource>.test.ts` mocking `undici.fetch`. The existing tests are good templates.

Run `npm test` and `npm run build` to confirm it integrates cleanly. Commit, push, optionally cut a release (see below).

## Cut a release

```sh
# 1. Bump version in THREE places — all must match or release metadata drifts:
#    - package.json                    (top-level "version")
#    - src/server.ts                   (McpServer name+version block)
#    - package-lock.json               (root version + packages[""].version)
#      The lockfile is easiest to keep honest by running:
npm install --package-lock-only --ignore-scripts
#      (Don't hand-edit the lockfile; let npm regenerate.)

# 2. Move CHANGELOG [Unreleased] entries under a new [vX.Y.Z] — YYYY-MM-DD heading;
#    update HOWTO "Run tests locally" test count and Build bundle sizes if changed.

# 3. Confirm tests pass + build clean
npm test
npm run build

# 4. Commit + tag + push
git commit -am "release: vX.Y.Z — <short summary>"
git push
git tag -a vX.Y.Z -m "vX.Y.Z — short summary"
git push origin vX.Y.Z

# 5. GitHub Release with notes — pass --latest for stable releases, omit it for pre-releases
gh release create vX.Y.Z --latest --title "vX.Y.Z — title" --notes "<release notes>"

# 6. npm publish — paste-the-tag-first, npm-second so the GitHub tag is canonical
npm publish --tag latest        # for stable releases (X.Y.Z)
# or
npm publish --tag beta          # for beta pre-releases (X.Y.Z-beta.N)
# or
npm publish --tag next          # for release candidates (X.Y.Z-rc.N)
```

After step 6 lands, `npx capsulemcp` (or `npx capsulemcp@X.Y.Z` to pin) picks up the new version from the npm registry immediately. The GitHub-ref install (`npx -y github:soil-dev/capsulemcp#vX.Y.Z`) also works and is documented as the fallback / development path for users tracking a fork or unreleased branch.

If you also publish a container image and deploy from it, do the image-build + IaC-apply *after* the tag is on GitHub — the tag is the authoritative ref the image build clones from. See [DEPLOY.md](DEPLOY.md) for one worked example (Cloud Run from source) and adapt to your platform.

### Pre-release sanity checklist

Easy things to forget that have bitten us before. The items prefixed
**(CI)** are already enforced by `.github/workflows/ci.yml` on every
push, so they should be passing before you even start a release — but
re-confirm locally because a release commit shouldn't be the one that
discovers a regression.

- [ ] **(CI)** `npm run typecheck && npm run lint && npm run format:check && npm run build && npm test` all pass on the commit you're about to tag.
- [ ] `npm publish --dry-run --tag latest` (for stable), `--tag beta` (for beta), or `--tag next` (for release candidates) runs clean — verifies the tarball contents, package.json shape, and that `bin` / `files` resolve. Catches publish-time regressions before they hit npm.
- [ ] **`package-lock.json` root version matches `package.json`.** Bumping the two source-of-truth files (package.json + server.ts) doesn't touch the lockfile root — it drifts silently. `npm install --package-lock-only --ignore-scripts` after the bump keeps it honest.
- [ ] **Three places all match**: `package.json`, `src/server.ts`, `package-lock.json` (root + `packages[""]`).
- [ ] **`#vX.Y.Z` pins in `README.md` and `INSTALL.md`** point to the new tag. Three locations in each file (the JSON snippet, the `claude mcp add` line, the export-then-add line in INSTALL).
- [ ] **CHANGELOG `[Unreleased]` is empty** after the cut — its content should now live under `[vX.Y.Z]`.
- [ ] **HOWTO test count and bundle sizes** reflect reality (greppable: `npm test 2>&1 | tail -3` and `npm run build 2>&1 | tail -5`).
- [ ] **README "N tools / N read-only" counts** still match — bumping a tool count without bumping these numbers silently drifts. The source of truth is `tests/tool-annotations.test.ts`, which asserts the live catalog size (`result.tools.length`, currently 92) and the read-only subset (`readOnly === 53`); run `npm test` and reconcile the README/CHANGELOG numbers with those assertions. (A raw `grep` over `src/server.ts` undercounts — registrations span `registerTool` / `registerBatchTool` / `registerToolTask` / `server.tool`, often multi-line.)
- [ ] **After npm publish, verify the registry state**: `npm view capsulemcp dist-tags version versions --json` includes the new version and the intended dist-tag (`latest`, `beta`, or `next`). Git tags alone don't make `npx capsulemcp@X.Y.Z` installable.
- [ ] **Tag exists before triggering downstream builds**: any image-build pipeline that takes a git ref expects the tag to already be on GitHub.
- [ ] **Verify the image-build workflow's `conclusion`, not just exit status.** Piping `gh run watch --exit-status` through `tail` (or any non-pipefail shell) silently swallows the non-zero exit. Use `gh run view <id> --json conclusion --jq .conclusion` or `gh run list --workflow=... --limit=1 --json conclusion --jq '.[0].conclusion'` after the watch returns, and gate the deploy on the result being `"success"`. The beta.1/beta.2 deploys both shipped because the workflow had `conclusion: failure` but the local `tail` pipe masked the exit code.

Versioning convention:

| Bump | When |
|---|---|
| Patch (`0.3.0` → `0.3.1`) | Bug fixes, doc updates, internal refactors |
| Minor (`0.3.0` → `0.4.0`) | New tools, new env vars, new transport options. Backwards-compatible behaviour change |
| Major (`0.x.y` → `1.0.0`) | Breaking change. Pre-1.0 there's no formal stability promise; treat 1.0 as the first time you commit to API stability |

## Use MCP Tasks for long-running batch writes

The 6 `batch_*` write tools (`batch_update_party`,
`batch_update_opportunity`, `batch_update_project`, `batch_complete_task`,
`batch_add_tag`, `batch_remove_tag_by_id`) support the **MCP Tasks primitive**
(SEP-1686, "call-now, fetch-later"). When the operator has
`MCP_TASKS_ENABLED=1` set on the OAuth HTTP deployment, clients
can augment a `tools/call` with `params.task` to dispatch the work
asynchronously and poll for the result later.

**You only need this if your client wants to do other work
concurrently while a batch runs.** Most clients (including Claude
today) don't augment with `params.task`, and they get the existing
synchronous behaviour. With tasks disabled, the connector registers
ordinary synchronous tools. With tasks enabled, the SDK runs
`handleAutomaticTaskPolling` internally and returns the final
`CallToolResult` as before. No configuration change is required for
legacy callers.

### Augmented request shape

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "batch_update_party",
    "arguments": {
      "items": [
        { "id": 101, "about": "Met at RSAC" },
        { "id": 102, "about": "Met at RSAC" }
      ]
    },
    "task": {
      "ttl": 60000
    }
  }
}
```

The server responds immediately with a `CreateTaskResult` envelope:

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "taskId": "abc123…",
      "status": "submitted",
      "ttl": 60000,
      "pollInterval": 1500,
      "createdAt": "2026-05-19T13:00:00.000Z"
    }
  }
}
```

### Poll for completion

```jsonc
{ "jsonrpc": "2.0", "id": 2, "method": "tasks/get",
  "params": { "taskId": "abc123…" } }
```

When status reaches `completed`:

```jsonc
{ "jsonrpc": "2.0", "id": 3, "method": "tasks/result",
  "params": { "taskId": "abc123…" } }
```

The response payload is the same `CallToolResult` shape a
synchronous `tools/call` would have returned (content + summary).

### Cancel a running batch

```jsonc
{ "jsonrpc": "2.0", "id": 4, "method": "tasks/cancel",
  "params": { "taskId": "abc123…" } }
```

In-flight items run to completion (we can't pre-empt a Capsule
HTTP round-trip mid-flight) but no new items are claimed. The
result array reflects this — already-completed items show `ok:
true`, items the worker pool hadn't claimed yet show `ok: false,
error: { message: "cancelled by tasks/cancel" }`.

### Sizing & limits

- `ttl` is clamped to `MCP_TASKS_MAX_KEEP_ALIVE_MS` (default 15 min)
- Each clientId can hold up to `MCP_TASKS_MAX_PER_CLIENT` tasks
  concurrently (default 20)
- Process-wide cap is `MCP_TASKS_MAX_TOTAL` (default 200)
- Excess `createTask` calls return `InvalidParams` with a
  `Task quota exceeded` message

See DEPLOY.md for the full env-var table, DESIGN.md L10 for the
trust/security model, and CHANGELOG `[1.6.0-alpha.1]` for the
release notes.

## Debug a tool that's misbehaving

Reproduce locally with the wire-trace if it's a write tool:

```sh
npm run build
CAPSULE_API_TOKEN=<your token> npx tsx scripts/wire-trace.ts
```

Or call the tool function directly with `tsx` (the IIFE wrapper is needed because `tsx -e` doesn't enable top-level await by default):

```sh
CAPSULE_API_TOKEN=<your token> npx tsx -e '
  (async () => {
    const { searchParties } = await import("./src/tools/parties.js");
    const r = await searchParties({ q: "Acme", page: 1, perPage: 10 });
    console.log(JSON.stringify(r, null, 2));
  })();
'
```

To see the raw HTTP traffic:

```sh
CAPSULE_API_TOKEN=<your token> NODE_DEBUG=undici npx tsx -e '...' 2>&1 | head -50
```

If a Capsule endpoint behaves unexpectedly, hit it directly with curl:

```sh
curl -s -H "Authorization: Bearer $CAPSULE_API_TOKEN" \
     -H "Accept: application/json" \
     "https://api.capsulecrm.com/api/v2/parties/<id>?embed=tags,fields" | python3 -m json.tool
```

The `CAPSULE_API_BASE_URL` env var lets you swap the base URL — useful for hitting a mock server in tests.

## Troubleshooting recipes

| Problem | First check |
|---|---|
| Tool not visible to Claude | `tools/list` via the inspector or smoke script — is it actually registered? |
| `npx` install pulling stale code | `rm -rf ~/.npm/_npx`, restart Claude Desktop |
| Tests pass but live behaviour differs | Capsule API may have undocumented quirks; verify with curl |
| OAuth dance succeeds but `/mcp` 401s | `MCP_OAUTH_SIGNING_KEY` differs between issuance and verification — usually means a deploy rolled in between |
| Cloud Run instance idle / cold | First request after ~15 min idle takes a few seconds. Set `--min-instances=1` to eliminate |

For deployment-specific troubleshooting see [DEPLOY.md](DEPLOY.md#troubleshooting).
