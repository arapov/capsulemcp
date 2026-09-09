/**
 * Helper to register an MCP tool whose handler returns any value and
 * needs to be wrapped in the standard JSON-stringify-into-text MCP
 * response shape.
 *
 * Why this exists:
 * - Reduces 8 lines per `server.tool(...)` registration to a single
 *   call, collapsing >400 LOC of repetitive wrapper boilerplate
 *   in src/server.ts.
 * - Puts the tool NAME and DESCRIPTION on the same call (positional
 *   args 2 and 3), eliminating the "Edit collapses two adjacent
 *   string lines" footgun that has hit the alpha series three times
 *   while editing description text.
 *
 * The exception is `get_attachment` — its handler does
 * content-type-aware response shaping (image vs text vs binary) and
 * needs the raw `server.tool(...)` call. That registration stays
 * inline.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateTaskRequestHandlerExtra,
  TaskRequestHandlerExtra,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodRawShape } from "zod";
import type { BatchOpts } from "../capsule/batch.js";
import { getRequestContext, logEvent } from "../log.js";
import { shouldRegister } from "./tier.js";
import { finishTaskExecution, registerAbortController } from "../tasks/store.js";

/**
 * Prefixes that identify a tool as read-only by naming convention.
 * The catalog uses these strictly — any tool starting with one of
 * these is guaranteed not to issue a Capsule mutating request.
 */
const READ_PREFIXES = ["search_", "filter_", "get_", "list_", "show_", "run_"];

/**
 * Tools whose semantics are destructive (unrecoverable detach of a
 * workflow / party association). These ALREADY carry a
 * `confirm: true` schema-level gate in their input schemas; the
 * annotation here is a separate, client-facing hint surfacing the
 * same "needs confirmation" signal to MCP clients that respect
 * `destructiveHint` for stronger pre-call prompts (e.g. Claude
 * Desktop / Claude Code auto-approval heuristics).
 *
 * Whole-record `delete_*` tools are caught by the `delete_` prefix
 * in `isDestructive` below, so a NEW `delete_X` tool added in the
 * future auto-inherits the destructive hint without anyone having
 * to remember to update a list. Only the non-`delete_` destructive
 * names need to be enumerated here.
 *
 * "Child remover" tools (`remove_party_email_address_by_id`,
 * `remove_tag_by_id`, etc.) are NOT included — they detach a row
 * from a record but the parent record persists, so they're routine
 * writes, not destructive in the spec sense.
 */
const DESTRUCTIVE_NON_DELETE = new Set(["remove_track", "remove_additional_party"]);

function isDestructive(name: string): boolean {
  return name.startsWith("delete_") || DESTRUCTIVE_NON_DELETE.has(name);
}

/**
 * Infer MCP `ToolAnnotations` from the tool name.
 *
 * The catalog's naming convention is strict (verified by the
 * mcp-integration tool-count assertion plus the destructive list
 * above), so we can derive accurate hints without touching every
 * registration site.
 *
 * Returned shapes (every tool gets a full hint set — see "Why
 * explicit destructiveHint" below):
 *
 *   - Read-prefixed tools → `{ readOnlyHint: true, destructiveHint: false }`.
 *     Clients can use this to auto-approve invocations, removing
 *     per-call confirmation prompts for safe reads.
 *
 *   - Destructive tools (whole-record deletes + workflow / party-
 *     association removers) → `{ readOnlyHint: false, destructiveHint: true }`.
 *     Clients can surface a stronger pre-call warning. Our schema-
 *     level `confirm: true` gate is the actual hard stop; this is
 *     the hint that travels over the wire to the client UI.
 *
 *   - Everything else (creates, updates, additive child writes,
 *     batches) → `{ readOnlyHint: false, destructiveHint: false }`.
 *     Routine writes that mutate data but don't delete it — clients
 *     should prompt before invocation (the absence of `readOnlyHint`
 *     ensures they don't auto-approve) but shouldn't escalate to the
 *     destructive-warning UI.
 *
 * Why explicit destructiveHint everywhere:
 * Per MCP spec, `destructiveHint`'s DEFAULT IS `true`. So a tool
 * that emits only `{readOnlyHint: true}` or omits annotations
 * entirely resolves (in spec-compliant clients) to
 * `{destructiveHint: true}` — destructive by default. Real-world
 * Claude clients have been observed treating that implicit-true as
 * load-bearing even when `readOnlyHint: true` is also set, despite
 * the spec saying `destructiveHint` is "meaningful only when
 * readOnlyHint == false". The defensive fix is to never rely on
 * spec defaults — emit the full hint pair explicitly so the wire
 * shape is unambiguous regardless of client interpretation.
 *
 * `openWorldHint` is left unset because the default (true,
 * "interacts with external entities") already matches every Capsule
 * tool. `idempotentHint` is left unset because idempotency in our
 * codebase is per-tool runtime behaviour (see `capsule/idempotent.ts`)
 * rather than a catalog-level property — surfacing it would imply a
 * guarantee the runtime doesn't always make.
 */
export function inferAnnotations(name: string): ToolAnnotations {
  if (READ_PREFIXES.some((p) => name.startsWith(p))) {
    return { readOnlyHint: true, destructiveHint: false };
  }
  if (isDestructive(name)) {
    return { readOnlyHint: false, destructiveHint: true };
  }
  return { readOnlyHint: false, destructiveHint: false };
}

/**
 * Extract the names of fields present on the tool input. Used by the
 * `tool.call` event so analytics queries can ask "which schema
 * fields do callers actually populate" without ever logging the
 * values themselves. Returns `[]` for non-object inputs.
 */
function argFieldNames(input: unknown): string[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.keys(input as Record<string, unknown>);
}

/**
 * Single emission point for `tool.call` events. Used by both
 * `registerTool` (sync path, success + error) and
 * `registerToolTask`'s background IIFE so the event shape stays
 * consistent across all three call sites. Builds `durationMs` from
 * `startedAt` to remove timing-math duplication.
 */
function emitToolCall(opts: {
  tool: string;
  clientId?: string;
  argFields: string[];
  startedAt: number;
  outcome: "success" | "error";
  taskAugmented?: boolean;
}): void {
  logEvent("tool.call", {
    tool: opts.tool,
    ...(opts.clientId ? { clientId: opts.clientId } : {}),
    argFields: opts.argFields,
    durationMs: Date.now() - opts.startedAt,
    outcome: opts.outcome,
    ...(opts.taskAugmented ? { taskAugmented: true } : {}),
  });
}

/** Wrap a handler's return value in the MCP `content: [{text}]` shape. */
function wrapAsText(result: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

/**
 * Register an MCP tool whose handler takes a zod-typed input and
 * returns any JSON-serialisable value. The value gets wrapped in the
 * standard MCP text-content response.
 */
export function registerTool<Schema extends z.ZodObject<ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  handler: (input: z.infer<Schema>) => Promise<unknown>,
): void {
  // Tool-catalog tiering: skip registration when the configured tier
  // excludes this tool (see src/server/tier.ts).
  if (!shouldRegister(name)) return;
  // Use the SDK config-form registerTool with the full Zod schema. The
  // deprecated shape overload rebuilds z.object(schema.shape), which drops
  // object-level refinements such as superRefine.
  const registerWithSchema = server.registerTool.bind(server) as (
    toolName: string,
    config: {
      description: string;
      inputSchema: Schema;
      annotations?: ToolAnnotations;
    },
    callback: (input: z.infer<Schema>) => Promise<CallToolResult>,
  ) => void;

  const annotations = inferAnnotations(name);
  registerWithSchema(name, { description, inputSchema: schema, annotations }, async (input) => {
    const startedAt = Date.now();
    const argFields = argFieldNames(input);
    const clientId = getRequestContext()?.clientId;
    try {
      const result = await handler(input);
      emitToolCall({ tool: name, clientId, argFields, startedAt, outcome: "success" });
      return wrapAsText(result);
    } catch (err) {
      emitToolCall({ tool: name, clientId, argFields, startedAt, outcome: "error" });
      throw err;
    }
  });
}

/**
 * Register a task-augmented MCP tool (SEP-1686).
 *
 * Behaviour with `taskSupport: 'optional'`:
 *
 *   - Caller does **not** send `params.task` → SDK runs
 *     `handleAutomaticTaskPolling`: calls our `createTask`, polls
 *     the store internally, returns the final `CallToolResult` to
 *     the client. Caller never sees a task envelope. This is what
 *     existing clients (Claude, today) hit; behaviour is identical
 *     to the non-task path apart from the SDK's internal polling.
 *
 *   - Caller sends `params.task: { ttl?, pollInterval? }` → SDK
 *     calls our `createTask`, returns the `CreateTaskResult`
 *     envelope synchronously. Caller polls via `tasks/get` and
 *     retrieves via `tasks/result`.
 *
 * Handler signature mirrors `registerTool`'s, plus an optional
 * `opts: { signal?: AbortSignal }` second arg. The signal fires
 * when the caller sends `tasks/cancel` — handlers that fan out
 * (the 6 `batch_*` writes today) pass the signal into
 * `batchExecute` so unclaimed items get a `cancelled` error rather
 * than running.
 *
 * The handler's return value is wrapped identically to
 * `registerTool` so the eventual `tasks/result` payload looks the
 * same as a synchronous `tools/call` result.
 */
export function registerToolTask<Schema extends z.ZodObject<ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  handler: (input: z.infer<Schema>, opts: BatchOpts) => Promise<unknown>,
): void {
  // Tool-catalog tiering: skip registration when the configured tier
  // excludes this tool (see src/server/tier.ts).
  if (!shouldRegister(name)) return;
  // We reach into the experimental namespace; the SDK explicitly
  // labels these APIs as such ("WARNING: These APIs are experimental
  // and may change without notice"). Keeping the surface area we
  // touch here narrow makes future SDK upgrades a one-file change.
  // Same casting trick as registerTool above: the SDK's overload
  // signatures parameterise on a custom AnySchema / ZodRawShapeCompat
  // pair that TS can't infer directly from our z.ZodObject. Bind
  // to a function type that mentions exactly the surface we want
  // (description + inputSchema + execution).
  type TaskHandler = {
    createTask: (input: z.infer<Schema>, extra: CreateTaskRequestHandlerExtra) => Promise<unknown>;
    getTask: (input: z.infer<Schema>, extra: TaskRequestHandlerExtra) => Promise<unknown>;
    getTaskResult: (
      input: z.infer<Schema>,
      extra: TaskRequestHandlerExtra,
    ) => Promise<CallToolResult>;
  };
  const registerWithSchema = server.experimental.tasks.registerToolTask.bind(
    server.experimental.tasks,
  ) as (
    name: string,
    config: {
      description: string;
      inputSchema: Schema;
      execution: { taskSupport: "optional" | "required" };
      annotations?: ToolAnnotations;
    },
    handler: TaskHandler,
  ) => void;

  const annotations = inferAnnotations(name);
  registerWithSchema(
    name,
    {
      description,
      inputSchema: schema,
      execution: { taskSupport: "optional" },
      annotations,
    },
    {
      createTask: async (input: z.infer<Schema>, extra: CreateTaskRequestHandlerExtra) => {
        // The SDK exposes a *simplified* `RequestTaskStore` surface
        // via `extra.taskStore` — `createTask` here takes only
        // `taskParams`; the SDK threads `requestId` and the original
        // `request` internally. The full 4-arg surface only exists
        // on the underlying `TaskStore` we passed to the server.
        //
        // Forward the caller's requested TTL. The SDK parses
        // `params.task.ttl` from the inbound request and surfaces it
        // as `extra.taskRequestedTtl` (see
        // @modelcontextprotocol/sdk/.../shared/protocol.js:354).
        // Our scoped store (`src/tasks/store.ts`) clamps the value
        // to `[1000ms, maxKeepAliveMs]`; passing `undefined` falls
        // through to `defaultTtlMs`. The SDK does NOT surface the
        // caller's `pollInterval` hint on `extra` (only `ttl`), so
        // pollInterval stays as our `defaultPollFrequencyMs`.
        const task = await extra.taskStore.createTask({
          ttl: extra.taskRequestedTtl,
        });

        // Wire a per-task AbortController BEFORE kicking off the
        // background work. The SDK's `tasks/cancel` handler only
        // flips the task's status — our store override (see
        // src/tasks/store.ts) is what fires this controller. Doing
        // this before the void IIFE guarantees there's no window
        // where a tasks/cancel arrives before the abort hook is
        // installed: the SDK's tasks/cancel call also goes through
        // `extra.taskStore`, which won't see the cancellation flip
        // until our `createTask` resolves anyway. Using a per-task
        // controller (not `extra.signal`) because `extra.signal`
        // belongs to the original `tools/call` request — that
        // request resolves the instant we return `{ task }`, so
        // its signal is no longer useful.
        const abortController = new AbortController();
        registerAbortController(task.taskId, abortController);

        // Background execution — the whole point of tasks is that
        // the JSON-RPC response returns before the work finishes.
        // Errors go into the task as a `failed` CallToolResult
        // (isError: true); they MUST NOT propagate out (no one is
        // awaiting this promise) and they MUST NOT use the task
        // `failed` lifecycle status, which is reserved for
        // task-machinery failures, not the wrapped tool's own
        // error path. See SEP-1686 §7.2.
        //
        // CRITICAL: every interaction with `extra.taskStore` from
        // the background goes through the SDK's protocol.js wrapper,
        // which — after the store operation succeeds — attempts to
        // emit `notifications/tasks/status` on the original request's
        // notification channel. Under stateless HTTP POST `/mcp`,
        // that channel is closed the instant we return `{ task }`,
        // so the notification throws. The store side-effect already
        // happened (verified by reading the underlying SDK store),
        // but the throw propagates up as if the whole call failed.
        // Wrap each call independently and swallow the throw:
        //   - re-trying storeTaskResult after a successful store
        //     means the task is in terminal status and the SDK
        //     throws "results can only be stored once", which is
        //     an unhandled rejection from the void IIFE → process
        //     exit → instance recycle → all tasks lost.
        // The integration test suite uses InMemoryTransport which
        // keeps the channel open, so this codepath was invisible
        // until production verification. See CHANGELOG.
        // Snapshot the request context's clientId here, while the
        // ALS frame is still active. The IIFE below runs after the
        // outer HTTP request has returned, so `getRequestContext()`
        // would be undefined inside it; capturing eagerly preserves
        // the clientId on the `tool.call` event the IIFE emits.
        const requestClientId = getRequestContext()?.clientId;
        const argFields = argFieldNames(input);

        void (async () => {
          try {
            if (abortController.signal.aborted) return;

            // Status-→ working. The notification side may throw under
            // stateless POST; the status flip is what matters.
            try {
              await extra.taskStore.updateTaskStatus(task.taskId, "working");
            } catch {
              // Swallow: the underlying store either succeeded (most
              // likely; the throw came from notification) or the task
              // was concurrently cancelled. Both cases recover below.
            }

            // Run the handler. Capture its result OR a CallToolResult-
            // shaped error envelope — we always end up storing one
            // payload, never re-entering this branch.
            const handlerStart = Date.now();
            let payload: CallToolResult;
            let outcome: "success" | "error" = "success";
            try {
              const result = await handler(input, {
                signal: abortController.signal,
              });
              payload = wrapAsText(result);
            } catch (err) {
              if (abortController.signal.aborted) return;
              outcome = "error";
              const message = err instanceof Error ? err.message : String(err);
              payload = {
                content: [{ type: "text", text: message }],
                isError: true,
              };
            }

            // Emit tool.call BEFORE storeTaskResult. The
            // updateTaskStatus → terminal transition would unwind the
            // request-context-aware path; logging here ensures the
            // event lands with the captured clientId and a sensible
            // durationMs even if the store interaction throws on a
            // closed notification stream.
            emitToolCall({
              tool: name,
              clientId: requestClientId,
              argFields,
              startedAt: handlerStart,
              outcome,
              taskAugmented: true,
            });

            // If cancellation fired during execution, the task's
            // status is already `cancelled` (terminal); SEP-1686 §4.3
            // forbids transitioning out of terminal. Skip the store.
            if (abortController.signal.aborted) return;

            // Store once. Any throw past this point is the SDK's
            // notification path hitting a closed stream — the
            // underlying store already has the result, so we log and
            // move on. Do NOT re-enter a catch that calls
            // storeTaskResult again.
            try {
              await extra.taskStore.storeTaskResult(task.taskId, "completed", payload);
            } catch {
              // Best-effort: notification failed on a closed SSE
              // stream. The result was stored before the notification
              // attempt, so callers polling tasks/result will see it.
              // No re-store — that would fail with "already in
              // terminal status" and crash the process.
            }
          } finally {
            finishTaskExecution(task.taskId);
          }
        })();

        return { task };
      },
      getTask: async (_input: z.infer<Schema>, extra: TaskRequestHandlerExtra) =>
        extra.taskStore.getTask(extra.taskId),
      getTaskResult: async (_input: z.infer<Schema>, extra: TaskRequestHandlerExtra) => {
        const r = await extra.taskStore.getTaskResult(extra.taskId);
        // Not a no-op: the store returns the SDK's loose `Result` shape,
        // but this handler's signature requires CallToolResult (with
        // `content`). Our runner only ever stores wrapAsText payloads or
        // structured error contents, so the narrowing holds at runtime.
        return r as CallToolResult;
      },
    },
  );
}
