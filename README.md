# capsulemcp

[![capsulemcp MCP server](https://glama.ai/mcp/servers/soil-dev/capsulemcp/badges/score.svg)](https://glama.ai/mcp/servers/soil-dev/capsulemcp)

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Capsule CRM](https://capsulecrm.com). Connect Claude (Desktop, Code, or web Projects via Custom Connector) to your CRM and let it answer natural-language questions across the full record graph: contacts, organisations, opportunities, projects, tasks, and timeline activity. Beyond the basics it covers structured filters with field/operator conditions, saved searches with sort, workflow tracks (templates and instances), file attachments (read + write), audit of deleted records, and batch fetches up to 50 records per call.

- **92 tools** across the Capsule resource graph (53 in read-only mode) — full read coverage plus careful, confirm-gated writes; 6 batched-write tools (`batch_*`) for mass-update workflows
- **Two transports**: stdio for local installs (Claude Desktop / Code), HTTP+OAuth for hosted Custom Connectors
- **Read-only mode** as a one-env-var flag; works alongside read-scoped Capsule tokens
- **MCP tool annotations**: 53 read tools carry `readOnlyHint: true`, 8 destructive ones carry `destructiveHint: true` — clients that honor these hints can auto-approve safe reads while still prompting for writes/destructive calls
- **Apache 2.0**

## Pick your install

| You want | Read this |
|---|---|
| Example questions to ask once the connector is running | [EXAMPLES.md](EXAMPLES.md) |
| To use it locally with Claude Desktop or Claude Code | [INSTALL.md](INSTALL.md) |
| To deploy it once and have your whole team use it via Claude.ai | [DEPLOY.md](DEPLOY.md) |
| To wire it into n8n workflows | [INTEGRATIONS-n8n.md](INTEGRATIONS-n8n.md) |
| To contribute, debug, add a tool, or cut a release | [HOWTO.md](HOWTO.md) (procedures) · [CONTRIBUTING.md](CONTRIBUTING.md) (style & PR checks) |
| To understand what's intentionally not implemented (and why) | [DESIGN.md](DESIGN.md) |
| To see what performance work has been done (and what's next) | [OPTIMIZATIONS.md](OPTIMIZATIONS.md) |
| To see ideas for features that might land in future versions | [IDEAS.md](IDEAS.md) |
| To learn the surprising parts of Capsule's v2 API (with verbatim doc quotes) | [NOTES-ON-CAPSULE-API.md](NOTES-ON-CAPSULE-API.md) |

For most individual users the install is a single JSON snippet pasted into Claude Desktop's config — see [INSTALL.md](INSTALL.md).

## Quick start (Claude Desktop)

1. Generate a Capsule API token: **My Preferences → API Authentication Tokens → Generate**, choose the **Read** scope for safety.
2. Add this to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

   ```json
   {
     "mcpServers": {
       "capsule": {
         "command": "npx",
         "args": ["-y", "capsulemcp"],
         "env": {
           "CAPSULE_API_TOKEN": "<paste token here>",
           "CAPSULE_MCP_READONLY": "1"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop. The Capsule tools appear in the tool picker.

That's it. The first launch fetches the package from npm (a few seconds); subsequent launches are instant from the npx cache. To pin a specific version, use `"capsulemcp@2.3.1"` in `args`. If you're tracking a fork or an unreleased branch, use the GitHub-ref form instead: `"github:soil-dev/capsulemcp#v2.3.1"` — same arguments, just installs from a git clone rather than the npm registry. See [INSTALL.md](INSTALL.md) for the Claude Code path, manual install, and troubleshooting.

## Tools

| Group | Read | Write |
|---|---|---|
| Parties (people/orgs) | `search_parties`, `filter_parties`, `get_party`, `get_parties`, `list_employees`, `list_party_opportunities`, `list_party_projects`, `list_party_entries` | `create_party`, `update_party`, `delete_party`, `add_party_email_address`, `remove_party_email_address_by_id`, `add_party_phone_number`, `remove_party_phone_number_by_id`, `add_party_address`, `remove_party_address_by_id`, `add_party_website`, `remove_party_website_by_id` |
| Opportunities | `search_opportunities`, `filter_opportunities`, `get_opportunity`, `get_opportunities`, `list_opportunity_entries`, `list_associated_projects` | `create_opportunity`, `update_opportunity`, `delete_opportunity` |
| Projects | `search_projects`, `list_projects`, `filter_projects`, `get_project`, `get_projects`, `list_project_entries` | `create_project`, `update_project`, `delete_project` |
| Additional parties (multi-party deals) | `list_additional_parties` | `add_additional_party`, `remove_additional_party` |
| Tasks | `list_tasks`, `get_task`, `get_tasks` | `create_task`, `update_task`, `complete_task`, `delete_task` |
| Entries (notes / captured emails) | `get_entry`, `list_entries` | `add_note`, `update_entry`, `delete_entry` |
| Attachments (file upload / download) | `get_attachment` | `upload_attachment` |
| Activity feed (tenant-wide) | `list_activities` | — |
| Audit (deleted records) | `list_deleted_parties`, `list_deleted_opportunities`, `list_deleted_projects` | — |
| Pipelines & milestones (opportunities) | `list_pipelines`, `list_milestones` | — |
| Boards & stages (projects) | `list_boards`, `list_stages` | — |
| Tracks (workflow instances) | `list_track_definitions`, `list_entity_tracks`, `get_track` | `apply_track`, `update_track`, `remove_track` |
| Saved filters | `list_saved_filters`, `run_saved_filter` | — |
| Custom fields (schema) | `list_custom_fields`, `get_custom_field` | — |
| Tags | `list_tags` | `add_tag`, `remove_tag_by_id`, `delete_tag_definition` |
| Users & teams | `list_users`, `get_current_user`, `list_teams` | — |
| Reference metadata | `list_lost_reasons`, `list_activity_types`, `list_categories`, `list_goals`, `list_countries`, `list_currencies`, `get_site` | — |

Most record-list tools default `perPage=25`; reference-data tools default `perPage=100` so small accounts usually fit in one response. All paginated tools cap `perPage` at 100 and return a `nextPage` cursor when more results exist. Many GET tools accept an `embed` parameter (e.g. `tags,fields`) — each tool's description enumerates its valid tokens (validated per resource; unknown tokens are rejected rather than silently ignored, and the caller-facing `project` token maps to Capsule's legacy `kase` on the wire).

The `filter_*` tools wrap Capsule's structured filter endpoint (`POST /<entity>/filters/results`) and accept an array of `{field, operator, value}` conditions ANDed together. Capsule's API does not support ad-hoc sort, so for "most recent X" questions filter by a date condition (e.g. `addedOn is within last 7`) and pick the highest id from the result — Capsule's numeric IDs are monotonically incrementing.

If you want **sortable** queries, use **saved filters** instead. Create the filter once in Capsule's web UI (it lets you set conditions, columns, and orderBy), then call `run_saved_filter` with its id. Use `list_saved_filters` to discover what's available.

### Read-only mode

Set `CAPSULE_MCP_READONLY=1` to disable every write/delete tool at the MCP layer (none of `create_*`, `update_*`, `complete_task`, `add_note`, or `delete_*` are registered). Pair it with a Capsule token that has the **Read** scope for defence in depth — your token's scope is the hard ceiling regardless of the env var.

### Delete safety

Every whole-record `delete_*` tool, plus `remove_track` and `remove_additional_party`, requires `confirm: true` in its arguments. Without it, the schema rejects the call before any HTTP is made. Tool descriptions tell Claude to read the entity first and confirm with the user before invoking. The combined design — read-scoped token, read-only mode flag, schema-level confirm gate — means destructive actions are deliberate, not accidental.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Anton Arapov.
