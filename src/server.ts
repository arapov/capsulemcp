import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isReadOnly } from "./capsule/client.js";
import { ICONS } from "./icon.js";
import { registerTool, registerToolTask } from "./server/register-tool.js";
import { shouldRegister } from "./server/tier.js";
import { getTasksConfig } from "./tasks/config.js";
import { createScopedTaskStore } from "./tasks/store.js";

import {
  searchPartiesSchema,
  searchParties,
  getPartySchema,
  getParty,
  getPartiesSchema,
  getParties,
  listPartyOpportunitiesSchema,
  listPartyOpportunities,
  listPartyProjectsSchema,
  listPartyProjects,
  createPartySchema,
  createParty,
  updatePartySchema,
  updateParty,
  batchUpdatePartySchema,
  batchUpdateParty,
  deletePartySchema,
  deleteParty,
  addPartyEmailAddressSchema,
  addPartyEmailAddress,
  removePartyEmailAddressByIdSchema,
  removePartyEmailAddressById,
  addPartyPhoneNumberSchema,
  addPartyPhoneNumber,
  removePartyPhoneNumberByIdSchema,
  removePartyPhoneNumberById,
  addPartyAddressSchema,
  addPartyAddress,
  removePartyAddressByIdSchema,
  removePartyAddressById,
  addPartyWebsiteSchema,
  addPartyWebsite,
  removePartyWebsiteByIdSchema,
  removePartyWebsiteById,
} from "./tools/parties.js";

import {
  searchOpportunitiesSchema,
  searchOpportunities,
  getOpportunitySchema,
  getOpportunity,
  getOpportunitiesSchema,
  getOpportunities,
  createOpportunitySchema,
  createOpportunity,
  updateOpportunitySchema,
  updateOpportunity,
  batchUpdateOpportunitySchema,
  batchUpdateOpportunity,
  deleteOpportunitySchema,
  deleteOpportunity,
} from "./tools/opportunities.js";

import {
  searchProjectsSchema,
  searchProjects,
  listProjectsSchema,
  listProjects,
  getProjectSchema,
  getProject,
  getProjectsSchema,
  getProjects,
  createProjectSchema,
  createProject,
  updateProjectSchema,
  updateProject,
  batchUpdateProjectSchema,
  batchUpdateProject,
  deleteProjectSchema,
  deleteProject,
} from "./tools/projects.js";

import {
  listTasksSchema,
  listTasks,
  getTaskSchema,
  getTask,
  getTasksSchema,
  getTasks,
  createTaskSchema,
  createTask,
  updateTaskSchema,
  updateTask,
  completeTaskSchema,
  completeTask,
  batchCompleteTaskSchema,
  batchCompleteTask,
  deleteTaskSchema,
  deleteTask,
} from "./tools/tasks.js";

import {
  listPartyEntriesSchema,
  listPartyEntries,
  listOpportunityEntriesSchema,
  listOpportunityEntries,
  listProjectEntriesSchema,
  listProjectEntries,
  getEntrySchema,
  getEntry,
  listEntriesSchema,
  listEntries,
  addNoteSchema,
  addNote,
  updateEntrySchema,
  updateEntry,
  deleteEntrySchema,
  deleteEntry,
} from "./tools/entries.js";
import {
  listPipelinesSchema,
  listPipelines,
  listMilestonesSchema,
  listMilestones,
} from "./tools/pipelines.js";
import { listBoardsSchema, listBoards, listStagesSchema, listStages } from "./tools/boards.js";
import {
  listTagsSchema,
  listTags,
  addTagSchema,
  addTag,
  removeTagByIdSchema,
  removeTagById,
  deleteTagDefinitionSchema,
  deleteTagDefinition,
  batchAddTagSchema,
  batchAddTag,
  batchRemoveTagByIdSchema,
  batchRemoveTagById,
} from "./tools/tags.js";
import { listUsersSchema, listUsers, getCurrentUserSchema, getCurrentUser } from "./tools/users.js";
import {
  filterPartiesSchema,
  filterParties,
  filterOpportunitiesSchema,
  filterOpportunities,
  filterProjectsSchema,
  filterProjects,
} from "./tools/filters.js";
import {
  listTeamsSchema,
  listTeams,
  listLostReasonsSchema,
  listLostReasons,
  listActivityTypesSchema,
  listActivityTypes,
  getSiteSchema,
  getSite,
  listTrackDefinitionsSchema,
  listTrackDefinitions,
  listCategoriesSchema,
  listCategories,
  listGoalsSchema,
  listGoals,
  listCountriesSchema,
  listCountries,
  listCurrenciesSchema,
  listCurrencies,
} from "./tools/metadata.js";
import { listActivitiesSchema, listActivities } from "./tools/activities.js";
import {
  listEmployeesSchema,
  listEmployees,
  listDeletedPartiesSchema,
  listDeletedParties,
  listDeletedOpportunitiesSchema,
  listDeletedOpportunities,
  listDeletedProjectsSchema,
  listDeletedProjects,
} from "./tools/audit.js";
import {
  listAdditionalPartiesSchema,
  listAdditionalParties,
  addAdditionalPartySchema,
  addAdditionalParty,
  removeAdditionalPartySchema,
  removeAdditionalParty,
  listAssociatedProjectsSchema,
  listAssociatedProjects,
} from "./tools/relationships.js";
import {
  listCustomFieldsSchema,
  listCustomFields,
  getCustomFieldSchema,
  getCustomField,
} from "./tools/custom-fields.js";
import {
  listEntityTracksSchema,
  listEntityTracks,
  getTrackSchema,
  getTrack,
  applyTrackSchema,
  applyTrack,
  updateTrackSchema,
  updateTrack,
  removeTrackSchema,
  removeTrack,
} from "./tools/tracks.js";
import {
  getAttachmentSchema,
  getAttachment,
  uploadAttachmentSchema,
  uploadAttachment,
} from "./tools/attachments.js";
import {
  listSavedFiltersSchema,
  listSavedFilters,
  runSavedFilterSchema,
  runSavedFilter,
} from "./tools/saved-filters.js";

/**
 * Build a fully-configured MCP server with all Capsule tools registered.
 *
 * Read-only mode is determined at call time (via CAPSULE_MCP_READONLY) so
 * that callers in long-lived processes — like the HTTP transport which
 * may construct one server per request — see fresh env state.
 *
 * Returns the server uninitialised; the caller is responsible for
 * connecting it to a transport.
 *
 * Tool registrations use the `registerTool` helper from
 * src/server/register-tool.ts to keep each registration on a single
 * line — collapses the ~8-line `server.tool(...)` boilerplate that
 * grew through the alpha series, and incidentally eliminates the
 * "Edit collapses two adjacent string lines" footgun by putting the
 * name and description on the same call. The one exception is
 * `get_attachment` (further down): its handler does content-type-aware
 * response shaping and stays as a raw `server.tool(...)` call.
 */
/**
 * Build an `McpServer` configured for one inbound HTTP request.
 *
 * `opts.clientId` is the authenticated OAuth client_id (from
 * `req.auth.clientId`). It's optional because the stdio entrypoint
 * (`src/index.ts`) has no OAuth and runs unauthenticated against
 * Capsule. Tasks (SEP-1686) are only wired when both
 * `MCP_TASKS_ENABLED=1` AND a `clientId` is present — the in-memory
 * store needs a per-caller scope to be safe (see
 * `src/tasks/store.ts`).
 */
export function createCapsuleMcpServer(opts?: { clientId?: string }): McpServer {
  const readOnly = isReadOnly();
  const tasksCfg = getTasksConfig();
  const tasksWired = tasksCfg.enabled && !!opts?.clientId;

  // `taskStore` and `capabilities.tasks` go on the SDK ServerOptions,
  // not on the high-level McpServer info object. McpServer accepts a
  // second argument for these. See @modelcontextprotocol/sdk
  // server/mcp.d.ts line 24.
  const server = new McpServer(
    {
      name: "capsulemcp",
      version: "2.3.1",
      description:
        "Read and (optionally) modify Capsule CRM data — parties, opportunities, projects, tasks, timeline entries, pipelines, tags.",
      websiteUrl: "https://github.com/soil-dev/capsulemcp",
      icons: ICONS,
    },
    tasksWired
      ? {
          // tasksWired guards clientId presence; narrow explicitly
          // for the type-checker rather than using `!`.
          taskStore: createScopedTaskStore(opts?.clientId ?? ""),
          capabilities: {
            tasks: {
              // The SDK's task capability schema uses {} for "present"
              // markers, not booleans — see ServerTasksCapabilitySchema
              // in @modelcontextprotocol/sdk types.ts.
              list: {},
              cancel: {},
              requests: { tools: { call: {} } },
            },
          },
        }
      : undefined,
  );

  // Single decision-point for the 6 batch_* writes. When tasks are
  // wired, register as task-augmented (`taskSupport: "optional"`).
  // When they're not, register as ordinary synchronous tools — the
  // SDK's auto-poll path requires a `taskStore`, which we don't
  // have when `MCP_TASKS_ENABLED` is unset or the caller is the
  // stdio entrypoint (no clientId). Decided once, closed over
  // `server` and `tasksWired` so the 6 call sites below don't
  // repeat the gating.
  const registerBatchTool: typeof registerToolTask = tasksWired
    ? registerToolTask
    : (s, name, description, schema, handler) =>
        registerTool(s, name, description, schema, (input) => handler(input, {}));

  // ── Parties ───────────────────────────────────────────────────────────────

  registerTool(
    server,
    "search_parties",
    "Free-text search or list people and organisations in Capsule CRM. Returns results in Capsule's default order (no sort parameter is supported here). For structured queries — 'most recent', 'tagged X', 'added this month' — use filter_parties instead.",
    searchPartiesSchema,
    searchParties,
  );

  registerTool(
    server,
    "filter_parties",
    "Filter parties by structured conditions (date ranges, tags, fields). Use this — not search_parties — for questions like 'most recent client', 'parties added this week', 'parties tagged VIP'. Capsule's API does not support ad-hoc sort, but for 'most recent X' you can filter by a date field (e.g. {field: 'addedOn', operator: 'is within last', value: 30}) and pick the highest-id row from the result — Capsule IDs are monotonic, so newest id = newest record.",
    filterPartiesSchema,
    filterParties,
  );

  registerTool(
    server,
    "get_party",
    "Fetch a single party (person or organisation) by its numeric id. Returns the full record including type, name fields, emails, phones, addresses, websites, and any embedded tags or custom fields. Use embed='tags,fields' to include those in one round-trip. For batch fetches of up to 50 parties at once, use get_parties instead.",
    getPartySchema,
    getParty,
  );

  registerTool(
    server,
    "get_parties",
    "Batch-fetch up to 50 parties by ID. For 1–10 ids this is a single Capsule round trip (native multi-id endpoint); for 11–50 ids the connector transparently splits into 10-id chunks and fans out parallel Capsule requests, so the caller sees a single tool call with all results merged. Use this whenever Claude has several party IDs to avoid N sequential round trips of get_party.",
    getPartiesSchema,
    getParties,
  );

  registerTool(
    server,
    "list_party_opportunities",
    "List opportunities linked to a given party. Returns the same record shape as get_opportunity, filtered to one party — use this to answer 'what deals do we have with X?' without enumerating all opportunities. Accepts optional embed (e.g. 'tags,fields') to include those in one round-trip.",
    listPartyOpportunitiesSchema,
    listPartyOpportunities,
  );

  registerTool(
    server,
    "list_party_projects",
    "List projects linked to a given party. Returns the same record shape as get_project, filtered to one party — use this to answer 'what projects is X involved in?' without enumerating all projects. Accepts optional embed (e.g. 'tags,fields'). For the opportunity-side analogue, use list_party_opportunities.",
    listPartyProjectsSchema,
    listPartyProjects,
  );

  registerTool(
    server,
    "list_employees",
    "List the people who work at a given organisation party. Returns the parties whose `organisation` field references the given partyId. Use this to answer 'who works at X?' rather than enumerating all parties.",
    listEmployeesSchema,
    listEmployees,
  );

  registerTool(
    server,
    "list_custom_fields",
    "List custom field DEFINITIONS for an entity type (parties, opportunities, or projects). Returns the schema — name, type, options for list-type fields, etc. — NOT the values on any specific record. To read values on a record, use get_party / get_opportunity / get_project with embed=fields.",
    listCustomFieldsSchema,
    listCustomFields,
  );

  registerTool(
    server,
    "get_custom_field",
    "Show a single custom field DEFINITION by id. Use list_custom_fields first to discover field ids.",
    getCustomFieldSchema,
    getCustomField,
  );

  registerTool(
    server,
    "list_deleted_parties",
    "Audit feature: list parties deleted on or after a given timestamp. The `since` parameter is REQUIRED (Capsule rejects the call without it). Response also includes a `restrictedParties` key — records the integration user can see were deleted but cannot read fully.",
    listDeletedPartiesSchema,
    listDeletedParties,
  );

  if (!readOnly) {
    registerTool(
      server,
      "create_party",
      "Create a new person or organisation in Capsule CRM. For type='person', firstName or lastName is required (one suffices); the `name` field is silently ignored. For type='organisation', `name` is required and firstName/lastName/title/jobTitle are silently ignored. Passing organisationId pointing at a non-organisation party (e.g. another person's id) returns 404 'organisation not found' — Capsule filters lookups by type. Accepts `ownerId` and `teamId` to set ownership at create time; both are optional and Capsule defaults `owner` to the API-token user when omitted (team has no default).",
      createPartySchema,
      createParty,
    );

    registerTool(
      server,
      "update_party",
      "Update top-level fields on an existing party (about, firstName/lastName/name/title/jobTitle, ownerId, teamId, organisationId). `ownerId` and `teamId` both accept `null` to unassign — the combination `{ownerId: null, teamId: <id>}` puts a party into 'team-owned, no specific user' state (the common pattern when transferring ownership to a team after a user departs). For PERSON parties, organisationId links to an organisation or null unlinks; for ORGANISATION parties Capsule silently ignores organisationId. Only the fields you provide are changed. Child arrays (emailAddresses / phoneNumbers / addresses / websites) on this tool are APPEND-ONLY: items are merged into the existing list, not replaced. For surgical changes — replacing one email, removing one phone number, fixing the type on one address — use the dedicated atomic tools: add_party_email_address / remove_party_email_address_by_id (and the phone/address/website equivalents).",
      updatePartySchema,
      updateParty,
    );

    registerBatchTool(
      server,
      "batch_update_party",
      "Update 1–50 parties in parallel. Same input shape as update_party but wrapped in an `items` array. Use this — not N sequential update_party calls — for any homogeneous multi-record write (mass owner reassignment, bulk metadata corrections, etc.). Capsule has no batch-write API, so the connector fans out parallel HTTP requests with a default concurrency cap of 5 (configurable via CAPSULE_MCP_BATCH_CONCURRENCY). Returns { results: [{ok, ...} per item], summary: {total, succeeded, failed} }. Partial failures are possible — Capsule has no rollback, so successful items stay applied even if other items 4xx. Read the per-item result array to know which ones need follow-up.",
      batchUpdatePartySchema,
      batchUpdateParty,
    );

    registerTool(
      server,
      "delete_party",
      "DESTRUCTIVE & IRREVERSIBLE: permanently delete a party (person or organisation). Cascades to all linked notes, tasks, opportunities, AND projects. Deleting an organisation does NOT delete people linked to it via organisationId — their `organisation` field is silently cleared to null and they survive as standalone records. TRACK INSTANCES applied to cascaded opportunities/projects are NOT cleaned up either — they survive as orphan records reachable only by track id via get_track. Use remove_track on each track explicitly before deleting the parent party if orphan accumulation matters (rare in practice — orphans are unreachable from normal navigation). Requires confirm=true. Always read the party first with get_party and confirm with the user before calling. Idempotent on retry: response is `{deleted: true, alreadyDeleted: false, id}` on a fresh delete or `{deleted: true, alreadyDeleted: true, id}` if the party was already gone (Capsule's 404 is caught internally so reconciliation loops can re-issue safely).",
      deletePartySchema,
      deleteParty,
    );

    // ── Atomic child-array operations (avoid append-only surprises) ─────
    registerTool(
      server,
      "add_party_email_address",
      "Append a single email address to a party. Atomic — one PUT to Capsule. Use this instead of update_party.emailAddresses when you want to add exactly one entry; the bulk array on update_party is append-only and won't replace.",
      addPartyEmailAddressSchema,
      addPartyEmailAddress,
    );

    registerTool(
      server,
      "remove_party_email_address_by_id",
      "Remove one email-address entry from a party by its row id. Atomic and reversible — no `confirm: true` gate (re-add with add_party_email_address). Discover the id via get_party — each entry in the emailAddresses array carries one. Use this to replace an existing entry: remove the old id, then call add_party_email_address with the new value (any associated server-side metadata on the old row is discarded along with the row). Idempotent on retry: response is `{removed: true, alreadyRemoved: false, partyId, emailAddressId, party}` on a fresh remove (the updated party shape is included) or `{removed: true, alreadyRemoved: true, partyId, emailAddressId}` if the row was already gone (Capsule's 404 is caught).",
      removePartyEmailAddressByIdSchema,
      removePartyEmailAddressById,
    );

    registerTool(
      server,
      "add_party_phone_number",
      "Append a single phone number to a party. Atomic — one PUT to Capsule. Use this instead of update_party.phoneNumbers for single-entry adds.",
      addPartyPhoneNumberSchema,
      addPartyPhoneNumber,
    );

    registerTool(
      server,
      "remove_party_phone_number_by_id",
      "Remove one phone-number entry from a party by its row id. Atomic and reversible — no `confirm: true` gate (re-add with add_party_phone_number). Discover the id via get_party. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, partyId, phoneNumberId, party}` on a fresh remove or `{removed: true, alreadyRemoved: true, partyId, phoneNumberId}` if the row was already gone.",
      removePartyPhoneNumberByIdSchema,
      removePartyPhoneNumberById,
    );

    registerTool(
      server,
      "add_party_address",
      "Append a single postal address to a party. Atomic — one PUT to Capsule. Use this instead of update_party.addresses for single-entry adds.",
      addPartyAddressSchema,
      addPartyAddress,
    );

    registerTool(
      server,
      "remove_party_address_by_id",
      "Remove one address entry from a party by its row id. Atomic and reversible — no `confirm: true` gate (re-add with add_party_address). Discover the id via get_party. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, partyId, addressId, party}` on a fresh remove or `{removed: true, alreadyRemoved: true, partyId, addressId}` if the row was already gone.",
      removePartyAddressByIdSchema,
      removePartyAddressById,
    );

    registerTool(
      server,
      "add_party_website",
      "Append a single website / social handle to a party. Atomic — one PUT to Capsule. Use this instead of update_party.websites for single-entry adds. The 'address' field is a URL when service='URL' or a handle (e.g. '@acmeco') for social services.",
      addPartyWebsiteSchema,
      addPartyWebsite,
    );

    registerTool(
      server,
      "remove_party_website_by_id",
      "Remove one website entry from a party by its row id. Atomic and reversible — no `confirm: true` gate (re-add with add_party_website). Discover the id via get_party. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, partyId, websiteId, party}` on a fresh remove or `{removed: true, alreadyRemoved: true, partyId, websiteId}` if the row was already gone.",
      removePartyWebsiteByIdSchema,
      removePartyWebsiteById,
    );
  }

  // ── Opportunities ─────────────────────────────────────────────────────────

  registerTool(
    server,
    "search_opportunities",
    "Free-text search or list opportunities in Capsule CRM. Returns results in Capsule's default order (no sort parameter is supported here). For structured queries — 'most recent', 'won this quarter', 'in pipeline X at milestone Y' — use filter_opportunities instead.",
    searchOpportunitiesSchema,
    searchOpportunities,
  );

  registerTool(
    server,
    "filter_opportunities",
    "Filter opportunities by structured conditions (milestone, value, close date, tags). Use this — not search_opportunities — for questions like 'last won deal', 'opportunities closed this month', 'pipeline X at milestone Y'. Capsule's API does not support ad-hoc sort, but for 'most recent X' you can filter by a date field (e.g. {field: 'closedOn', operator: 'is within last', value: 90}) and pick the highest-id row — Capsule IDs are monotonic, so newest id = newest record.",
    filterOpportunitiesSchema,
    filterOpportunities,
  );

  registerTool(
    server,
    "get_opportunity",
    "Fetch a single opportunity by its numeric id. Returns the full record including value, milestone, owner, party, and any embedded tags/custom fields. Use embed='tags,fields' to include those in one round-trip. For batch fetches of up to 50 opportunities at once, use get_opportunities instead.",
    getOpportunitySchema,
    getOpportunity,
  );

  registerTool(
    server,
    "get_opportunities",
    "Batch-fetch up to 50 opportunities by id. For 1–10 ids this is a single Capsule round trip (native multi-id endpoint); for 11–50 ids the connector transparently splits into 10-id chunks and fans out parallel Capsule requests, so the caller sees a single tool call with all results merged. Returns each opportunity's full record (value, milestone, owner, party). For a single id, use get_opportunity instead.",
    getOpportunitiesSchema,
    getOpportunities,
  );

  registerTool(
    server,
    "list_deleted_opportunities",
    "Audit feature: list opportunities deleted on or after a given timestamp. The `since` parameter is REQUIRED. Response also includes a `restrictedOpportunities` key for records the integration user can't read fully.",
    listDeletedOpportunitiesSchema,
    listDeletedOpportunities,
  );

  registerTool(
    server,
    "list_additional_parties",
    "List secondary party links on an opportunity or project. The 'main' party is on the entity itself (opportunity.party); additional parties are e.g. partners, consultants, or referrers also involved in the deal. Set entity to 'opportunities' or 'projects'.",
    listAdditionalPartiesSchema,
    listAdditionalParties,
  );

  registerTool(
    server,
    "list_associated_projects",
    "List projects associated with a given opportunity. Returns the same record shape as list_projects, filtered to one opportunity. The inverse direction (project → opportunity) is on each project's `opportunity` field directly, so this tool is only needed for opportunity → projects discovery — use list_party_projects for party → projects.",
    listAssociatedProjectsSchema,
    listAssociatedProjects,
  );

  if (!readOnly) {
    registerTool(
      server,
      "create_opportunity",
      "Create a new opportunity linked to a party. Requires partyId and milestoneId (which pins the deal to a specific pipeline stage — pipeline is inferred from the milestone). Value is optional but if amount is set, currency must be set too (3-letter ISO 4217 code, e.g. 'USD'). Discover valid milestone ids via list_pipelines + list_milestones first. For multi-party deals, use add_additional_party after creation.",
      createOpportunitySchema,
      createOpportunity,
    );

    registerTool(
      server,
      "update_opportunity",
      "Update fields on an existing opportunity, including the parent-reference field `partyId` to reassign the opp to a different primary party. `ownerId` and `teamId` both accept `null` to unassign (verified empirically in v1.6.5 wire-trace — brings update_opportunity into parity with update_party and update_project). The combination `{ownerId: null, teamId: <id>}` puts an opportunity into 'team-owned, no specific user' state, matching the pattern available on parties and projects. Only the fields you provide are changed. Closed (Won/Lost) opportunities ARE editable — Capsule does not enforce closed-record immutability, so `value`, `description`, etc. can be changed on a Won opp without warning. If the workflow needs historical revenue numbers to be stable, enforce that caller-side. Capsule requires every opportunity to have a party — passing `partyId: null` is rejected with 422 'party is required' (Unlike `update_task.partyId` which IS nullable — tasks can be orphaned in Capsule's model).",
      updateOpportunitySchema,
      updateOpportunity,
    );

    registerBatchTool(
      server,
      "batch_update_opportunity",
      "Update 1–50 opportunities in parallel. Same input shape as update_opportunity but wrapped in an `items` array. Use this — not N sequential update_opportunity calls — for mass stage transitions (e.g. move a milestone batch to Won), owner reassignments, or value adjustments. Connector fans out parallel HTTP requests, default cap 5 (CAPSULE_MCP_BATCH_CONCURRENCY). Returns { results: [{ok, ...} per item], summary: {total, succeeded, failed} }. Partial failures possible; Capsule has no rollback.",
      batchUpdateOpportunitySchema,
      batchUpdateOpportunity,
    );

    registerTool(
      server,
      "delete_opportunity",
      "DESTRUCTIVE & IRREVERSIBLE: permanently delete an opportunity. Requires confirm=true. Always read the opportunity first with get_opportunity and confirm with the user before calling. Idempotent on retry: response is `{deleted: true, alreadyDeleted: false, id}` on a fresh delete or `{deleted: true, alreadyDeleted: true, id}` if the opportunity was already gone.",
      deleteOpportunitySchema,
      deleteOpportunity,
    );
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  registerTool(
    server,
    "search_projects",
    "Free-text search projects in Capsule CRM (matches name and description). Returns results in Capsule's default order (no sort parameter is supported here). Omit `q` to list all projects. For structured queries — 'most recent project', 'projects opened this month', 'projects tagged X' — use filter_projects instead.",
    searchProjectsSchema,
    searchProjects,
  );

  registerTool(
    server,
    "list_projects",
    "List projects in Capsule CRM, optionally filtered by status. Returns results in Capsule's default order (no sort parameter is supported here). For free-text matching use search_projects; for structured queries — 'most recent project', 'projects opened this month', 'projects tagged X' — use filter_projects instead.",
    listProjectsSchema,
    listProjects,
  );

  registerTool(
    server,
    "filter_projects",
    "Filter projects by structured conditions (date ranges, status, tags, owner). Use this — not list_projects — for questions like 'most recent project', 'projects opened this month'. Capsule's API does not support ad-hoc sort, but for 'most recent X' you can filter by a date field and pick the highest-id row — Capsule IDs are monotonic, so newest id = newest record.",
    filterProjectsSchema,
    filterProjects,
  );

  registerTool(
    server,
    "get_project",
    "Fetch a single project by its numeric id. Returns the full record including name, description, status (OPEN/CLOSED), owner, stage, board, opportunityId (if linked), and timestamps. Use embed='tags,fields' to include attached tags and custom field values in one round-trip. For batch fetches of up to 50 projects at once, use get_projects instead. For the project's timeline (notes, captured emails, completed-task records) use list_project_entries.",
    getProjectSchema,
    getProject,
  );

  registerTool(
    server,
    "get_projects",
    "Batch-fetch up to 50 projects by ID. For 1–10 ids this is a single Capsule round trip; for 11–50 ids the connector transparently splits into 10-id chunks and fans out parallel Capsule requests, so the caller sees a single tool call with all results merged.",
    getProjectsSchema,
    getProjects,
  );

  registerTool(
    server,
    "list_deleted_projects",
    "Audit feature: list projects deleted on or after a given timestamp. The `since` parameter is REQUIRED. Response also includes a `restrictedProjects` key for records the integration user can't read fully.",
    listDeletedProjectsSchema,
    listDeletedProjects,
  );

  if (!readOnly) {
    registerTool(
      server,
      "create_project",
      "Create a new project in Capsule CRM linked to a party. Requires partyId and name; description, status, owner, and starting board/stage are optional. To pin a project to a specific board+stage on creation, pass stageId (which uniquely identifies a stage within a board). Discover valid ids via list_boards + list_stages. Returns the created project including its assigned id.",
      createProjectSchema,
      createProject,
    );

    registerTool(
      server,
      "update_project",
      "Update fields on an existing project, including the parent-reference field `partyId` to reassign the project to a different primary party. `ownerId`, `teamId`, and `stageId` all accept `null` to unassign (the latter removes the project from all stages — verified empirically in v1.6.5 wire-trace). Constraint: a project must always have at least one of {owner, team} set, so `teamId: null` on a project with no owner returns 422. Only the fields you provide are changed. Use status='CLOSED' to close a project. CLOSED projects remain fully editable — Capsule does not enforce closed-record immutability. Stage moves and description edits on a CLOSED project are accepted without warning. Capsule requires every project to have a party — passing `partyId: null` is rejected with 422 'party is required' (Unlike `update_task.partyId` which IS nullable — tasks can be orphaned in Capsule's model).",
      updateProjectSchema,
      updateProject,
    );

    registerBatchTool(
      server,
      "batch_update_project",
      "Update 1–50 projects in parallel. Same input shape as update_project but wrapped in an `items` array. Use this — not N sequential update_project calls — for mass stage transitions (e.g. move a board column of projects to a new stage), bulk owner reassignments after a personnel change, or batch closures. Mirrors batch_update_party and batch_update_opportunity — identical fan-out shape across the three entity types. Connector fans out parallel HTTP requests, default cap 5 (CAPSULE_MCP_BATCH_CONCURRENCY). Returns { results: [{ok, ...} per item], summary: {total, succeeded, failed} }. Partial failures possible; Capsule has no rollback.",
      batchUpdateProjectSchema,
      batchUpdateProject,
    );

    registerTool(
      server,
      "delete_project",
      "DESTRUCTIVE & IRREVERSIBLE: permanently delete a project. Prefer update_project with status='CLOSED' to close a project while preserving history. Requires confirm=true. Always read the project first with get_project and confirm with the user before calling. Idempotent on retry: response is `{deleted: true, alreadyDeleted: false, id}` on a fresh delete or `{deleted: true, alreadyDeleted: true, id}` if the project was already gone.",
      deleteProjectSchema,
      deleteProject,
    );

    // ── Relationships (writes) ──────────────────────────────────────────────
    registerTool(
      server,
      "add_additional_party",
      "Link an existing party as an additional (secondary) party on an opportunity or project. The 'main' party is set via update_opportunity / update_project; this adds *additional* parties beyond the main one. Idempotent — re-adding a linked party is harmless. Response: `{linked: true, alreadyLinked: false}` on a fresh link, `{linked: true, alreadyLinked: true}` if the party was already linked (Capsule's 422 'already a contact' / 'already related' is caught internally and converted).",
      addAdditionalPartySchema,
      addAdditionalParty,
    );

    registerTool(
      server,
      "remove_additional_party",
      "Remove an additional-party link between an opportunity/project and a party. The party itself is NOT deleted. Requires confirm=true. Reversible by re-adding via add_additional_party. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, entity, entityId, partyId}` on a fresh remove or `{removed: true, alreadyRemoved: true, ...}` if the link was already gone (Capsule's 404 is caught and converted).",
      removeAdditionalPartySchema,
      removeAdditionalParty,
    );

    // ── Tracks (writes) ─────────────────────────────────────────────────────
    registerTool(
      server,
      "apply_track",
      "Apply a track definition to an opportunity or project. Creates a track instance and auto-creates tasks per the track's task definitions; tasks' `dueOn` is computed from `startDate` (defaults to today) plus each task's `daysAfter` offset. Use list_track_definitions to discover available templates. NOT IDEMPOTENT — applying the same trackDefinitionId twice creates two independent track instances and two sets of auto-tasks (no de-duplication). If you want to apply only once, call list_entity_tracks first and check for an existing instance with the same trackDefinition.id (but mind that list_entity_tracks can include auto-applied tracks from board stage rules, not just manual applies).",
      applyTrackSchema,
      applyTrack,
    );

    registerTool(
      server,
      "update_track",
      "Update a track instance. Capsule's PUT semantics are partial — provide only the fields you want to change in `fields`. Common: { complete: true } to mark a track completed.",
      updateTrackSchema,
      updateTrack,
    );

    registerTool(
      server,
      "remove_track",
      "Remove a track instance from its entity. Capsule also deletes the auto-tasks the track created when it was applied; copy any task details you need before removing the track. Requires confirm=true. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, trackId}` on a fresh remove or `{removed: true, alreadyRemoved: true, trackId}` if the track was already gone.",
      removeTrackSchema,
      removeTrack,
    );
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  registerTool(
    server,
    "list_tasks",
    "List tasks in Capsule CRM. Defaults to OPEN tasks; pass status to broaden. Optionally filter to a specific owner via ownerId. Capsule does not expose a due-date filter on this endpoint — for that use filter_* tools elsewhere or iterate.",
    listTasksSchema,
    listTasks,
  );

  registerTool(
    server,
    "get_task",
    "Fetch a single task by its numeric id. Returns the task's description, due date, owner, completion state, and the entity it's attached to (party / opportunity / project, if any — standalone tasks not tied to a record are also valid). For batch fetches of up to 50 tasks at once, use get_tasks instead.",
    getTaskSchema,
    getTask,
  );

  registerTool(
    server,
    "get_tasks",
    "Batch-fetch up to 50 tasks by ID. For 1–10 ids this is a single Capsule round trip; for 11–50 ids the connector transparently splits into 10-id chunks and fans out parallel Capsule requests, so the caller sees a single tool call with all results merged.",
    getTasksSchema,
    getTasks,
  );

  if (!readOnly) {
    registerTool(
      server,
      "create_task",
      "Create a new task, optionally linked to a party, opportunity, or project. " +
        "Pass at most ONE of partyId / opportunityId / projectId — the connector rejects multi-target inputs before the HTTP call. " +
        "Omitting all three is also valid: Capsule creates the task as a STANDALONE task (no parent link), useful for personal reminders or workflow tasks that aren't tied to a specific CRM record.",
      createTaskSchema,
      createTask,
    );

    registerTool(
      server,
      "update_task",
      "Update fields on an existing task: `description`, `dueOn`, `dueTime`, `detail`, `status` (OPEN or COMPLETED), `ownerId`, and the parent-reference fields `partyId`, `opportunityId`, `projectId`. Pass a parent id to re-link the task, or null on a parent field to orphan/unlink it; at most one parent id may be set in a single call, though null+id swaps are allowed. Only the fields you provide are changed. To mark a task done, prefer the dedicated `complete_task` tool — it's idempotent (a no-op success on an already-completed task) and semantically clearer than `update_task status=COMPLETED`. Capsule rejects directly setting status=PENDING (which exists only internally for track-driven tasks); use OPEN or COMPLETED. Completed tasks remain fully editable — Capsule does not enforce closed-record immutability.",
      updateTaskSchema,
      updateTask,
    );

    registerTool(
      server,
      "complete_task",
      "Mark a task as done / completed / finished. Sets status=COMPLETED on the task, populating completedBy and completedAt while preserving the task in history (unlike delete_task which removes it permanently). Use this whenever a user says 'mark done', 'complete', 'finish', or similar — equivalent to update_task with status:COMPLETED but more discoverable.",
      completeTaskSchema,
      completeTask,
    );

    registerBatchTool(
      server,
      "batch_complete_task",
      "Mark 1–50 tasks COMPLETED in parallel. Pass `ids: [task_id, …]`. Natural for end-of-week catchups, 'close all the follow-ups from this campaign', etc. Connector fans out parallel HTTP requests, default cap 5 (CAPSULE_MCP_BATCH_CONCURRENCY). Returns { results: [{ok, ...} per id], summary: {total, succeeded, failed} }. A task that's already completed or deleted shows up as a per-item failure with the Capsule status; the rest still complete.",
      batchCompleteTaskSchema,
      batchCompleteTask,
    );

    registerTool(
      server,
      "delete_task",
      "DESTRUCTIVE & IRREVERSIBLE: permanently delete a task. Prefer complete_task to mark a task done while keeping it in history. Requires confirm=true. Idempotent on retry: response is `{deleted: true, alreadyDeleted: false, id}` on a fresh delete or `{deleted: true, alreadyDeleted: true, id}` if the task was already gone.",
      deleteTaskSchema,
      deleteTask,
    );
  }

  // ── Entries (notes, captured emails, completed-task records) ──────────────

  registerTool(
    server,
    "list_party_entries",
    "List timeline entries (notes, captured emails, completed-task records) for a party. Returns entries newest-first. Each entry has a type ('note', 'email', 'task'), free-text content, and timestamps. Use this to read the conversation history with a contact or organisation — answers questions like 'what's the latest with X?' For opportunity or project timelines, use list_opportunity_entries or list_project_entries respectively. " +
      "IMPORTANT for organisations: pass `includeLinkedPersons: true` to surface entries filed against the org's linked people (sales-conversation emails almost always land on a person row, not the org row — Capsule's API files each entry against exactly one party). Without this flag, an org with active customer-facing email will appear quiet here even though its `lastContactedAt` is current. For any 'what's new with $ORG?' query, set `includeLinkedPersons: true`.",
    listPartyEntriesSchema,
    listPartyEntries,
  );

  registerTool(
    server,
    "list_opportunity_entries",
    "List timeline entries (notes, captured emails, completed-task records) for an opportunity. Returns entries newest-first. Each entry has a type ('note', 'email', 'task'), free-text content, and timestamps. Use this to answer 'what's the latest on deal X?' For party or project timelines, use list_party_entries or list_project_entries respectively.",
    listOpportunityEntriesSchema,
    listOpportunityEntries,
  );

  registerTool(
    server,
    "list_project_entries",
    "List timeline entries (notes, captured emails, completed-task records) for a project. Returns entries newest-first. Each entry has a type ('note', 'email', 'task'), free-text content, and timestamps. Use this to answer 'what's the latest on project X?' For party or opportunity timelines, use list_party_entries or list_opportunity_entries respectively.",
    listProjectEntriesSchema,
    listProjectEntries,
  );

  registerTool(
    server,
    "get_entry",
    "Fetch a single timeline entry by its numeric id. Returns the full payload — for a note: the body text; for a captured email: subject, body, from/to, and timestamps; for a completed-task record: the original task fields. Useful when you have an entry id from one of the `list_*_entries` calls and want the full content. To modify the body or activity-type of an existing entry use `update_entry`; to delete one use `delete_entry`.",
    getEntrySchema,
    getEntry,
  );

  registerTool(
    server,
    "list_entries",
    "Global timeline feed: every note, captured email, and completed-task record across the whole Capsule account, paginated. Default order is most-recent-first. Use this for 'what activity happened today/this week across the company?' rather than iterating list_party_entries / list_opportunity_entries / list_project_entries.",
    listEntriesSchema,
    listEntries,
  );

  // ── Attachments ──────────────────────────────────────────────────────────
  //
  // get_attachment can't use registerTool because its handler does
  // content-type-aware response shaping (image → MCP image content,
  // text → text content, binary → metadata + base64). The raw
  // server.tool call stays here so the content shape can vary.

  if (shouldRegister("get_attachment")) {
    server.tool(
      "get_attachment",
      "Download an attachment by id. Returns image content for image/* types (Claude can describe it natively); decoded text for text/* and application/json (small files); JSON metadata + base64 payload for other binary types (PDF, Office docs, etc.). Files exceeding maxSizeBytes (default 5MB) return metadata only with a `truncated: true` flag.",
      getAttachmentSchema.shape,
      // get_attachment is read-only — downloads a binary, never mutates.
      // Mirrors the auto-inferred `{readOnlyHint: true, destructiveHint:
      // false}` that `registerTool` applies to every other `get_*` tool.
      // Explicit destructiveHint: false is load-bearing — MCP spec
      // defaults destructiveHint to `true`, so omitting it would (in
      // some client implementations) classify this read as destructive.
      { readOnlyHint: true, destructiveHint: false },
      async (input) => {
        const result = await getAttachment(input);

        // Truncated: return metadata only.
        if (result.truncated) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    id: input.id,
                    contentType: result.contentType,
                    sizeBytes: result.sizeBytes,
                    truncated: true,
                    message: `File exceeds the size cap (${input.maxSizeBytes ?? "default"} bytes). Increase maxSizeBytes if you need the bytes; max is 25MB.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Strip any Content-Type parameters (e.g. "; charset=UTF-8") before
        // comparing — Capsule routinely returns "image/png; charset=UTF-8"
        // and "application/json; charset=UTF-8". Without this, the
        // application/json branch would miss the charset variant and the
        // file would fall through to the binary base64 branch, which Claude
        // can't read directly.
        const baseType = result.contentType.split(";")[0]!.trim().toLowerCase();

        // Image: return as MCP image content so Claude can see it.
        if (baseType.startsWith("image/")) {
          return {
            content: [
              {
                type: "image",
                data: result.buffer.toString("base64"),
                mimeType: result.contentType,
              },
            ],
          };
        }

        // Text-ish: decode as UTF-8 alongside metadata.
        const isText =
          baseType.startsWith("text/") ||
          baseType === "application/json" ||
          baseType === "application/xml";
        if (isText) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    id: input.id,
                    contentType: result.contentType,
                    sizeBytes: result.sizeBytes,
                  },
                  null,
                  2,
                ),
              },
              { type: "text", text: result.buffer.toString("utf8") },
            ],
          };
        }

        // Other binary (PDF, Office, archive): metadata + base64 payload
        // for downstream tools (Claude itself can't read PDF bytes
        // directly, but can pass the base64 to other tools).
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: input.id,
                  contentType: result.contentType,
                  sizeBytes: result.sizeBytes,
                  base64: result.buffer.toString("base64"),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );
  }

  if (!readOnly) {
    registerTool(
      server,
      "add_note",
      "Add a note to a party, opportunity, or project. Provide exactly one of partyId, opportunityId, or projectId. The note is always attributed to the API-token owner — there is no override for the author (a `creatorId` parameter would enable audit-attribution spoofing on shared-connector deployments, so it is intentionally not exposed). Optional `entryAt` lets you backdate the note's authored-at timestamp for legitimate historical-import workflows.",
      addNoteSchema,
      addNote,
    );

    registerTool(
      server,
      "update_entry",
      "Edit an existing timeline entry — typically a note. Provide the entry id plus the fields you want to change (content, subject). Only the fields you supply are modified; other fields keep their current values. Cannot change the entry's type. Use this to correct or extend a note added previously.",
      updateEntrySchema,
      updateEntry,
    );

    registerTool(
      server,
      "upload_attachment",
      "Upload a file as a new note attachment, linked to a party, opportunity, or project. Provide the file as base64-encoded `dataBase64` along with `filename` and `contentType` (MIME). Also provide exactly one of partyId / opportunityId / projectId to anchor the note. Optionally pass `content` to set the note body (defaults to '[attachment]'). Two-step orchestration server-side: bytes upload → token → note creation. Adding to an existing entry is not supported.",
      uploadAttachmentSchema,
      uploadAttachment,
    );

    registerTool(
      server,
      "delete_entry",
      "DESTRUCTIVE & IRREVERSIBLE: permanently delete a note (or other entry) by its ID. Requires confirm=true. Idempotent on retry: response is `{deleted: true, alreadyDeleted: false, id}` on a fresh delete or `{deleted: true, alreadyDeleted: true, id}` if the entry was already gone.",
      deleteEntrySchema,
      deleteEntry,
    );
  }

  // ── Pipelines & milestones ────────────────────────────────────────────────

  registerTool(
    server,
    "list_pipelines",
    "List all sales pipelines defined in Capsule CRM. Returns each pipeline's id, name, and milestones (deal stages, ordered by position). Use this to discover the pipelineId when creating an opportunity, then pick a milestone from the same pipeline via list_milestones. Pipelines are stable per Capsule account — list once and cache; they rarely change.",
    listPipelinesSchema,
    listPipelines,
  );

  registerTool(
    server,
    "list_milestones",
    "List milestones (deal stages) within a specific opportunity pipeline. Returns each milestone's id, name, probability, and position. Used when creating opportunities (pass milestoneId to create_opportunity) or moving them across stages (set milestoneId in update_opportunity). Discover the pipelineId first via list_pipelines. Milestones are pipeline-scoped — not interchangeable across pipelines.",
    listMilestonesSchema,
    listMilestones,
  );

  // ── Boards & stages (project workflow metadata) ───────────────────────────
  //
  // Boards/stages are to projects what pipelines/milestones are to
  // opportunities. A project sits at one stage at a time on one board.

  registerTool(
    server,
    "list_boards",
    "List all project boards defined in Capsule. A board is a grouping of stages that projects flow through — the project equivalent of an opportunity pipeline. Returns each board's id, name, and stages. Use this to discover boardId when creating a project, then pick a starting stage via list_stages. Like pipelines, boards are stable per account.",
    listBoardsSchema,
    listBoards,
  );

  registerTool(
    server,
    "list_stages",
    "List project stages. Without arguments returns every stage across every board (each entry carries a `.board` reference so you can tell them apart). Pass `boardId` to scope the result to one specific board's stages. Use this to discover the numeric `stage.id` that `create_project` / `update_project` consume — stage names alone won't do, Capsule resolves by id. For opportunity (deal) stages, use `list_pipelines` instead — opportunities don't have stages in the project sense.",
    listStagesSchema,
    listStages,
  );

  // ── Reference metadata (teams, lost reasons, activity types) ──────────────

  registerTool(
    server,
    "list_teams",
    "List all teams configured in the Capsule account. Useful as input for filter_* queries that scope by team, and for reporting. " +
      "LIMITATION: returns team identity only (id, name, description, timestamps). Capsule's v2 API does not expose team↔user membership through any endpoint — `GET /teams/{id}/users` 404s, `embed=users` is silently ignored, and `GET /users/{id}` doesn't include a `teams` field. To determine whether a given user belongs to a given team, either check Capsule's web UI Team Membership page, or probe via `update_project { ownerId: U, teamId: T }` / `batch_update_opportunity { items: [{ id: <any opp>, ownerId: U, teamId: T }] }` and read the response — 422 'owner is not a member of the team' means U ∉ T. Both probe paths apply the same membership constraint server-side.",
    listTeamsSchema,
    listTeams,
  );

  registerTool(
    server,
    "list_lost_reasons",
    "List all configured opportunity-loss reasons (e.g. 'Poor Qualification', 'Lost to competitor', 'Price too high'). Returns each reason's id and name; the set is account-configured rather than a fixed enum, so call this to discover valid ids before referencing a lostReason in update_opportunity when closing a deal as lost. Useful for analysing closed-lost opportunities by reason.",
    listLostReasonsSchema,
    listLostReasons,
  );

  registerTool(
    server,
    "list_activity_types",
    "List all configured activity types (e.g. Call, Meeting, Email). These are the categories used when logging timeline entries via add_note. Returns each type's id and name. The set is account-configured rather than a fixed enum, so call this to discover valid values before referencing an activityType in entry creation.",
    listActivityTypesSchema,
    listActivityTypes,
  );

  registerTool(
    server,
    "list_categories",
    "List configured entry/task categories (Call, Email, Meeting, Follow-up, etc.) with their colours. Returns each category's id, name, and colour. The set is account-configured rather than a fixed enum — call this to discover valid category ids before referencing one in add_note or create_task. Used to label and filter timeline entries and tasks.",
    listCategoriesSchema,
    listCategories,
  );

  registerTool(
    server,
    "list_track_definitions",
    "List workflow track definitions: reusable templates that auto-create tasks at configured intervals when applied to an opportunity or project. Each track includes nested taskDefinitions specifying what to create and when. Use this to understand what automations exist.",
    listTrackDefinitionsSchema,
    listTrackDefinitions,
  );

  registerTool(
    server,
    "list_entity_tracks",
    "List track INSTANCES on a specific record — i.e., which tracks have been applied to this opportunity / project / party. Distinct from list_track_definitions, which lists the templates. NOTE: some boards have stage-triggered automation that auto-applies tracks when an entity enters specific stages — tracks returned here may include BOTH manually-applied tracks (via apply_track) and auto-applied tracks from Capsule board rules. To distinguish, compare each track's `trackDefinition.id` against your application's apply_track call history.",
    listEntityTracksSchema,
    listEntityTracks,
  );

  registerTool(
    server,
    "get_track",
    "Fetch a single track instance by id. Returns the minimal Capsule projection: id, description, trackDateOn, direction, and the array of tasks attached to the track. Capsule's GET /tracks/{id} does NOT include a trackDefinition link, an entity reference, or a completion field — to find the entity a track is applied to, use list_entity_tracks (which lists track instances by their parent entity); to check completion, the track-tasks' own statuses are the proxy.",
    getTrackSchema,
    getTrack,
  );

  registerTool(
    server,
    "list_goals",
    "List sales / activity goals configured in the account (per-user or per-team revenue or activity targets). Returns an empty list for accounts that don't use the Goals feature.",
    listGoalsSchema,
    listGoals,
  );

  registerTool(
    server,
    "list_countries",
    "List Capsule's country dictionary (250 rows: name, alpha2Code, alpha3Code, numericCode, dialCode). The `name` values are the EXACT spellings accepted by party address `country` fields — Capsule rejects anything else with 422 'unknown country' (e.g. accepted: 'Czechia', 'United Kingdom'; rejected: 'Czech Republic', 'UK'). Consult this before add_party_address / update_party address writes when unsure of a spelling. Complete list in one response; cached (reference data).",
    listCountriesSchema,
    listCountries,
  );

  registerTool(
    server,
    "list_currencies",
    "List Capsule's currency dictionary (80 rows: ISO 4217 code, symbol, name). Valid codes for opportunity `value.currency`. Complete list in one response; cached (reference data).",
    listCurrenciesSchema,
    listCurrencies,
  );

  registerTool(
    server,
    "list_activities",
    "Global cross-entity ACTIVITY FEED: everything that happened across the tenant, newest first — typed rows (Note, Task completed, Email sent, Email received, plus custom types) with the acting user, the apiClient that made the change, and refs to the party/opportunity/project/task/entry concerned. Supports `since` (ISO-8601, server-side filter) and pagination. THE tool for 'what happened this week across the book', 'what did <user> touch today', or 'which emails came in' — one call instead of per-record entry fan-outs. No per-entity server-side filter: filter client-side on the returned refs. CAVEAT: undocumented Capsule endpoint (stable in observation; discovered by live probe) — could change without notice.",
    listActivitiesSchema,
    listActivities,
  );

  registerTool(
    server,
    "get_site",
    "Return the Capsule account this connector is currently authenticated against (subdomain, display name, URL). Diagnostic for 'which Capsule account is this?'. For the PAT owner's user identity, use get_current_user.",
    getSiteSchema,
    getSite,
  );

  // ── Saved filters (UI-defined filters; support sort, unlike ad-hoc) ───────

  registerTool(
    server,
    "list_saved_filters",
    "List all filters that users have saved in Capsule's web UI for an entity type. Saved filters are reusable — they bundle conditions, columns, and (importantly) sort. Use this to discover what queries are already configured before building a one-off filter_* call.",
    listSavedFiltersSchema,
    listSavedFilters,
  );

  registerTool(
    server,
    "run_saved_filter",
    "Run a saved filter by id and return its results, paginated. Unlike filter_parties / filter_opportunities / filter_projects (which use the ad-hoc filter endpoint and CANNOT sort), saved filters DO support sort — the orderBy is configured in Capsule's web UI when the filter is created. So 'most recent X by Y' questions are answerable in one call IF a saved filter exists; use list_saved_filters first to find one.",
    runSavedFilterSchema,
    runSavedFilter,
  );

  // ── Tags ──────────────────────────────────────────────────────────────────

  registerTool(
    server,
    "list_tags",
    "List all tags available for a given entity type (parties, opportunities, or projects). Returns each tag's id, name, and any data-tag field schema. Tags are entity-specific — a party tag is not interchangeable with an opportunity tag. Use this to discover valid tag ids before calling add_tag, or to display the tag catalogue to the user when they ask 'what tags do we use?'",
    listTagsSchema,
    listTags,
  );

  if (!readOnly) {
    registerTool(
      server,
      "add_tag",
      "Attach a tag to a party, opportunity, or project by NAME. Capsule resolves to an existing tag in the tenant or creates a fresh one with this name. Matching is case-insensitive — 'VIP' and 'vip' attach the same tag, preserving the canonical casing from whichever variant was created first. To avoid creating a genuinely-distinct near-duplicate (e.g. 'VIP' vs 'V.I.P.'), call list_tags first and reuse the exact name. Idempotent — re-attaching an already-attached tag is harmless. To DETACH a tag, use remove_tag_by_id with the tag's id (read via get_party/get_opportunity/get_project with embed='tags').",
      addTagSchema,
      addTag,
    );

    registerTool(
      server,
      "remove_tag_by_id",
      "Detach a tag from a party, opportunity, or project. Atomic — one PUT to Capsule. Reversible — no `confirm: true` gate (re-attach with add_tag using the same tag name). The `tagId` parameter is the tag's id, readable via get_party/get_opportunity/get_project with embed='tags' (list_tags returns the same ids and also works, but reading via embed first confirms the tag is actually attached to this entity). The tag definition itself remains in the tenant for other entities that still share it. Idempotent on retry: response is `{removed: true, alreadyRemoved: false, entity, entityId, tagId, ...<updated entity>}` on a fresh detach or `{removed: true, alreadyRemoved: true, entity, entityId, tagId}` if the tag was already detached (Capsule's 422 'tag not found to delete' is caught and converted).",
      removeTagByIdSchema,
      removeTagById,
    );

    registerTool(
      server,
      "delete_tag_definition",
      "DESTRUCTIVE & TENANT-WIDE: permanently delete a tag DEFINITION from an entity type's tag namespace (parties / opportunities / projects). Unlike remove_tag_by_id — which detaches a tag from ONE record and leaves the definition intact for others — this removes the definition itself, so the tag disappears from EVERY record that shared it. Use it to clean up stray / mistyped / test tag definitions polluting the tenant-global list. Requires confirm=true. Always read the affected tag first via list_tags and confirm with the user; if you only want to untag one record, use remove_tag_by_id instead. Irreversible (re-creating by name via add_tag mints a brand-new id). Idempotent on retry: `{deleted: true, alreadyDeleted: false, entity, tagId}` on a fresh delete, or `{deleted: true, alreadyDeleted: true, entity, tagId}` if the definition was already gone (Capsule's 404 is caught). Endpoint verified empirically (DELETE /<entity>/tags/{id} → 204).",
      deleteTagDefinitionSchema,
      deleteTagDefinition,
    );

    registerBatchTool(
      server,
      "batch_add_tag",
      "Attach tags to many entities in parallel — e.g. tag a list of 20 contacts as 'RSAC26' after a conference, or apply the 'Departed' tag to 10 people in a layoff batch. Pass `items: [{ entity, entityId, tagName }, ...]` (1–50 items). Each item is processed identically to a single add_tag call. Connector fans out parallel HTTP requests, default cap 5 (CAPSULE_MCP_BATCH_CONCURRENCY). Returns { results: [{ok, ...} per item], summary: {total, succeeded, failed} }. The list_tags cache is invalidated for each affected entity type.",
      batchAddTagSchema,
      batchAddTag,
    );

    registerBatchTool(
      server,
      "batch_remove_tag_by_id",
      "Detach tags from many entities in parallel — cleanup counterpart to batch_add_tag. Pass `items: [{ entity, entityId, tagId }, ...]` (1–50 items). Each item is processed identically to a single remove_tag_by_id call (already-detached tags are reported as idempotent successes, not failures). Connector fans out parallel HTTP requests, default cap 5. Returns { results: [{ok, ...} per item], summary: {total, succeeded, failed} }.",
      batchRemoveTagByIdSchema,
      batchRemoveTagById,
    );
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  registerTool(
    server,
    "list_users",
    "List all users in the Capsule account. Returns each user's id, username, optional first/last name, role, and party reference. Some users may have null first/last name fields (only username set) — fall back to username for display. Use this to discover user ids for owner-filtered queries against opportunities, projects, and tasks, or to map a user to their party record via user.party.id.",
    listUsersSchema,
    listUsers,
  );

  registerTool(
    server,
    "get_current_user",
    "Show the user owning the API token this connector is using. Useful for audit ('under whose Capsule identity is the connector running?') and for confirming a token rotation moved ownership to the expected account. Wraps Capsule's GET /users/current — note the endpoint is /users/current, not /users/me.",
    getCurrentUserSchema,
    getCurrentUser,
  );

  return server;
}
