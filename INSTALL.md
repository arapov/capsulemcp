# Installing capsulemcp locally

For per-user installs running on your own laptop. If you're an admin looking to deploy this once for your whole organisation via a Custom Connector, see [DEPLOY.md](DEPLOY.md) instead.

## Requirements

- [Node.js 22 or newer](https://nodejs.org/) (`node --version` to check)
- A [Capsule CRM](https://capsulecrm.com) Personal Access Token. **My Preferences → API Authentication Tokens → Generate new token**. Pick the **Read** scope unless you specifically want write access — read-only is the safer default and the MCP can enforce it on top of that.

## Path 1 — Claude Desktop (most users)

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Paste this into the file (merge with existing `mcpServers` if you have other connectors):

```json
{
  "mcpServers": {
    "capsule": {
      "command": "npx",
      "args": ["-y", "capsulemcp"],
      "env": {
        "CAPSULE_API_TOKEN": "<your read-scoped capsule token>",
        "CAPSULE_MCP_READONLY": "1"
      }
    }
  }
}
```

Restart Claude Desktop. The Capsule tools appear in the tool picker.

> **Version pinning.** Replace `"capsulemcp"` with `"capsulemcp@2.3.1"` (or any other published version) to pin. By default `npx` resolves to the `latest` tag on npm; for production setups pinning is the safer choice.
>
> **First launch.** `npx` downloads the pre-built package from npm (a couple of seconds, much faster than the old GitHub-ref flow that had to clone + install + build). Subsequent launches are instant from the npx cache.

### Alternative: install from the GitHub repo

If you're tracking a fork, an unreleased branch, or a specific commit you control, swap the npm name for a GitHub ref:

```json
"args": ["-y", "github:soil-dev/capsulemcp#v2.3.1"]
```

Same flags, same env, just installs from a git clone instead of the npm tarball. Useful for development; for production, prefer the npm form above.

## Path 2 — Claude Code

```sh
claude mcp add capsule --env CAPSULE_API_TOKEN=<your token> -- npx -y capsulemcp
```

This writes the entry to Claude Code's MCP config (`~/.claude.json`). Same `env` model as Claude Desktop's JSON — no shell-export needed.

If you'd rather not have the token in `~/.claude.json`, omit the `--env` flag and export it in your shell profile so the spawned MCP server inherits it:

```sh
export CAPSULE_API_TOKEN=<your token>
claude mcp add capsule -- npx -y capsulemcp
```

To pin a version, replace `capsulemcp` with `capsulemcp@2.3.1`. To install from a GitHub ref instead of npm (development / fork tracking), replace it with `github:soil-dev/capsulemcp#v2.3.1`.

## Path 3 — Manual install (for development)

Useful if you want to hack on the code or pin to a specific commit you control:

```sh
git clone https://github.com/soil-dev/capsulemcp.git
cd capsulemcp
npm install      # also runs the build via the prepare script
```

Then point Claude Desktop at the built file with an absolute path:

```json
{
  "mcpServers": {
    "capsule": {
      "command": "node",
      "args": ["/absolute/path/to/capsulemcp/dist/index.js"],
      "env": {
        "CAPSULE_API_TOKEN": "<your token>",
        "CAPSULE_MCP_READONLY": "1"
      }
    }
  }
}
```

Workflow when you change code:

```sh
npm run build    # or `npm run dev` for tsup watch mode
```

Then restart Claude Desktop. It re-spawns the MCP server on each app start, picking up the new `dist/`.

## Verifying the install

Open a new chat in Claude Desktop / Claude Code. Ask:

> *Can you confirm you have access to my Capsule CRM? Don't query anything — just tell me what tool categories you see.*

Claude should respond with a list including parties, opportunities, projects, tasks, entries, pipelines, milestones, tags, users.

If Claude says it has no Capsule tools available, see Troubleshooting below.

## Updating

The `npx` install caches per-spec, so it does **not** auto-update from `master`. Two ways to upgrade:

1. **Bump the version in your config**: change the `#vX.Y.Z` tag to a newer tag and restart.
2. **Clear the npx cache**: `rm -rf ~/.npm/_npx` and restart Claude Desktop. Re-fetches whatever spec your config points at.

For "live tip of trunk" use `github:soil-dev/capsulemcp` (no version pin) plus the cache-clear approach. For predictable production-grade pinning use a specific tag.

For the manual install: `git pull && npm install && npm run build`, then restart Claude Desktop.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "I don't have access to Capsule" / no tools available | Connector not enabled in this chat / Project | Toggle the Capsule connector on in the chat composer's tool picker |
| First launch hangs for over a minute | npx is building the package on first use | Wait — it's normal. Check `~/.npm/_npx` to confirm a directory was created |
| Claude calls a tool but gets `401 Unauthorized` from Capsule | Wrong/expired `CAPSULE_API_TOKEN` | Regenerate the token in Capsule and update the config |
| Claude calls a write tool and gets a read-only error | `CAPSULE_MCP_READONLY=1` is set | Remove that env var if you actually want writes |
| Code changes don't show up after `npm run build` | Claude Desktop reuses the existing MCP child process | Quit Claude Desktop fully (Cmd-Q on macOS), reopen |
| `npx` cache problems after a tag change | npx caches per-spec forever | `rm -rf ~/.npm/_npx`, restart Claude Desktop |

For deeper debugging — running tests locally, adding a tool, releasing a new version — see [HOWTO.md](HOWTO.md).
