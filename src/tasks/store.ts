/**
 * Per-clientId scoped wrapper around the SDK's `InMemoryTaskStore`.
 *
 * The SDK auto-registers handlers for `tasks/get`, `tasks/result`,
 * `tasks/list`, and `tasks/cancel` when an `McpServer` is constructed
 * with a `taskStore`. Those handlers call our store directly, so the
 * store is the single point at which we can enforce the security
 * boundary we need:
 *
 *   - In capsulemcp's HTTP transport, each POST `/mcp` is its own
 *     stateless request. The `McpServer` is built fresh per request.
 *     The `TaskStore` therefore MUST be a process-singleton — if we
 *     gave each request a private store, the very next `tasks/get`
 *     wouldn't see the task that was just created.
 *
 *   - But a singleton has a footgun: any authenticated caller could
 *     poll any taskId — including taskIds owned by another OAuth
 *     client. SEP-1686 §8 ("Security Considerations") specifically
 *     calls out this scenario.
 *
 * The fix is `createScopedTaskStore(clientId)` — a per-request thin
 * wrapper that snapshots the caller's OAuth `clientId` at
 * construction, delegates every operation to the singleton, and
 * cross-checks the recorded owner of each taskId before returning
 * (or modifying) anything. A caller from clientId A sees `null` /
 * `task not found` for any taskId created by clientId B, exactly as
 * if it didn't exist.
 *
 * The wrapper also enforces two DoS caps cheaply:
 *
 *   - `maxPerClient` — per-clientId task count, defense against a
 *     compromised single tenant.
 *   - `maxTotal` — process-wide ceiling, defense against many
 *     tenants pushing simultaneously. With our current Cloud Run
 *     topology (`max_instance_count=1`, `min_instance_count=0`)
 *     the ceiling is the actual memory budget.
 *
 * On scale-to-zero, the singleton evaporates along with the
 * instance — all in-flight tasks are silently dropped. This is a
 * known limitation documented in DEPLOY.md; an external `TaskStore`
 * (Firestore/Redis) is the future upgrade path noted in IDEAS.md.
 */

import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import type {
  CreateTaskOptions,
  TaskStore,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import {
  ErrorCode,
  McpError,
  type Request,
  type RequestId,
  type Result,
  type Task,
} from "@modelcontextprotocol/sdk/types.js";
import { logEvent } from "../log.js";
import { getTasksConfig, MIN_TASK_TTL_MS } from "./config.js";

/**
 * Process-singleton SDK store. Lazily initialised so importing this
 * module is side-effect-free (matches the rest of the codebase).
 */
let _globalStore: InMemoryTaskStore | null = null;

function getGlobalStore(): InMemoryTaskStore {
  if (_globalStore === null) {
    _globalStore = new InMemoryTaskStore();
  }
  return _globalStore;
}

/**
 * Augment map: records the owning `clientId` for every taskId we
 * hand out. Lookups against the SDK store are gated through this
 * map; mismatched-owner reads are reported as `not found` to avoid
 * leaking the existence of a foreign task.
 *
 * Kept as a separate map from the SDK's `InMemoryTaskStore` because
 * the SDK has no concept of OAuth client identity by design — its
 * store is tenant-blind. `countPerClient` walks this map linearly
 * on every `createTask`; bounded by `MCP_TASKS_MAX_TOTAL`
 * (default 200), so the walk is sub-microsecond and not worth a
 * separate per-client counter map.
 */
const owners = new Map<string, string>();

/**
 * Per-task AbortController registry. The SDK's `tasks/cancel`
 * handler only updates the task status to `cancelled` — it does NOT
 * fire any AbortSignal. To make cancellation actually halt our
 * background batch fan-outs, the runner (`src/server/register-tool.ts`)
 * registers a controller here before kicking off work, and our
 * `updateTaskStatus` override below fires the controller when the
 * SDK transitions a task to `cancelled`. Cleared on terminal
 * transitions and on TTL eviction so the controllers don't leak.
 */
const abortControllers = new Map<string, AbortController>();

// Keep active work charged to its owner even after retention expires or
// cancellation removes the task's controller. In-flight requests may still
// be running; only the runner's finally block releases this reservation.
const runningOwners = new Map<string, string>();

/**
 * Runner-facing hook. Registers an AbortController for a task; when
 * the task's status flips to `cancelled` via the SDK's tasks/cancel
 * handler (which calls `updateTaskStatus` on our store), the
 * controller's `signal` fires. Called from the task runner right
 * after `createTask` so there's no window where a tasks/cancel
 * arrives before the abort handler is wired.
 */
export function registerAbortController(taskId: string, controller: AbortController): void {
  const owner = owners.get(taskId);
  if (owner === undefined) {
    controller.abort();
    return;
  }
  runningOwners.set(taskId, owner);
  abortControllers.set(taskId, controller);
}

export function finishTaskExecution(taskId: string): void {
  runningOwners.delete(taskId);
  abortControllers.delete(taskId);
}

/**
 * Per-task eviction timer handle + the clamped TTL it was scheduled
 * with. The owners / abortControllers augment maps must be swept in
 * lockstep with the SDK store's retention timer — and the SDK RESETS
 * that timer to `now + ttl` on every terminal transition
 * (`storeTaskResult`, and a terminal `updateTaskStatus`). The original
 * one-shot sweep, scheduled only at createTime + ttl, therefore drifted:
 * a task that ran a non-trivial fraction of its TTL before completing
 * had its owner entry evicted while the SDK still held the result,
 * making `getTaskResult` return "Task not found" to the legitimate
 * owner for a result the server still has. We keep the handle + ttl so
 * terminal transitions can reschedule in lockstep.
 */
const evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const taskTtls = new Map<string, number>();

/**
 * (Re)schedule the augment-map eviction for `taskId` at `now + ttlMs`,
 * clearing any prior timer first. `unref` so the timer never keeps the
 * Node event loop alive (Cloud Run instances must be free to scale to
 * zero). Mirrors the SDK store's own create/terminal-transition
 * scheduling so the two maps evict together.
 */
function scheduleEviction(taskId: string, clientId: string, ttlMs: number): void {
  const existing = evictionTimers.get(taskId);
  if (existing) clearTimeout(existing);
  taskTtls.set(taskId, ttlMs);
  const timer = setTimeout(() => {
    // Stop claiming queued writes before making the task untrackable.
    // Already-dispatched requests finish under the runningOwners quota.
    abortControllers.get(taskId)?.abort();
    owners.delete(taskId);
    abortControllers.delete(taskId);
    evictionTimers.delete(taskId);
    taskTtls.delete(taskId);
    logEvent("task.evicted", { taskId, clientId, reason: "ttl" });
  }, ttlMs);
  timer.unref?.();
  evictionTimers.set(taskId, timer);
}

/** Test-only reset hook. Clears the singleton and owner map. */
export function _resetTaskStoreForTests(): void {
  _globalStore?.cleanup();
  _globalStore = null;
  owners.clear();
  for (const timer of evictionTimers.values()) clearTimeout(timer);
  evictionTimers.clear();
  taskTtls.clear();
  for (const ctrl of abortControllers.values()) ctrl.abort();
  abortControllers.clear();
  runningOwners.clear();
}

function countPerClient(clientId: string): number {
  let n = 0;
  for (const owner of owners.values()) {
    if (owner === clientId) n++;
  }
  for (const [taskId, owner] of runningOwners) {
    if (owner === clientId && !owners.has(taskId)) n++;
  }
  return n;
}

function countTotal(): number {
  let n = owners.size;
  for (const taskId of runningOwners.keys()) {
    if (!owners.has(taskId)) n++;
  }
  return n;
}

/**
 * Build a per-clientId TaskStore wrapper bound to the singleton.
 *
 * Returns a fresh wrapper on every call (cheap — just a closure over
 * `clientId`), so each McpServer constructed for an inbound HTTP
 * request gets its own wrapper without sharing mutable state.
 */
export function createScopedTaskStore(clientId: string): TaskStore {
  if (!clientId) {
    // Tasks require an authenticated caller. Reject explicitly so
    // the bug — if any — surfaces in tests rather than silently
    // creating world-readable tasks.
    throw new Error("createScopedTaskStore: clientId is required");
  }

  const global = getGlobalStore();

  /**
   * Returns the task if and only if it exists AND is owned by this
   * wrapper's clientId. Otherwise returns null — same shape the SDK
   * returns for genuinely-missing tasks, so the SDK's `tasks/get`
   * handler converts it to a standard "task not found" error.
   */
  async function getOwned(taskId: string): Promise<Task | null> {
    if (owners.get(taskId) !== clientId) return null;
    return global.getTask(taskId);
  }

  return {
    async createTask(
      taskParams: CreateTaskOptions,
      requestId: RequestId,
      request: Request,
      sessionId?: string,
    ): Promise<Task> {
      const cfg = getTasksConfig();

      // Quota enforcement first — cheapest reject path.
      const totalNow = countTotal();
      if (totalNow >= cfg.maxTotal) {
        logEvent("task.rejected", {
          reason: "max_total",
          clientId,
          totalNow,
          cap: cfg.maxTotal,
        });
        throw new McpError(ErrorCode.InvalidParams, "Task quota exceeded for this server instance");
      }
      const perClientNow = countPerClient(clientId);
      if (perClientNow >= cfg.maxPerClient) {
        logEvent("task.rejected", {
          reason: "max_per_client",
          clientId,
          perClientNow,
          cap: cfg.maxPerClient,
        });
        throw new McpError(ErrorCode.InvalidParams, "Task quota exceeded for this client");
      }

      // Clamp TTL to [1000ms, maxKeepAliveMs]. `null` (unlimited) is
      // never honoured — we only support a bounded retention window
      // in the in-memory store, otherwise a stuck task pins memory
      // until process restart.
      const requestedTtl = taskParams.ttl;
      const clampedTtl =
        requestedTtl === null
          ? cfg.maxKeepAliveMs
          : Math.max(
              MIN_TASK_TTL_MS,
              Math.min(requestedTtl ?? cfg.defaultTtlMs, cfg.maxKeepAliveMs),
            );

      // Same applies to pollInterval — accept the caller's hint but
      // floor it at the configured suggestion to avoid hot loops.
      const requestedPoll = taskParams.pollInterval ?? cfg.defaultPollFrequencyMs;
      const clampedPoll = Math.max(cfg.defaultPollFrequencyMs, Math.floor(requestedPoll));

      const task = await global.createTask(
        { ttl: clampedTtl, pollInterval: clampedPoll, context: taskParams.context },
        requestId,
        request,
        sessionId,
      );
      owners.set(task.taskId, clientId);

      // Schedule augment-map cleanup at createTime + TTL; rescheduled in
      // lockstep with the SDK store on terminal transitions (see
      // scheduleEviction for why the original one-shot timer drifted).
      scheduleEviction(task.taskId, clientId, clampedTtl);

      logEvent("task.created", {
        taskId: task.taskId,
        clientId,
        ttl: clampedTtl,
        pollInterval: clampedPoll,
        method:
          typeof (request as { method?: unknown }).method === "string"
            ? (request as { method: string }).method
            : "unknown",
      });

      return task;
    },

    async getTask(taskId: string): Promise<Task | null> {
      return getOwned(taskId);
    },

    async storeTaskResult(
      taskId: string,
      status: "completed" | "failed",
      result: Result,
      sessionId?: string,
    ): Promise<void> {
      // Result-storing comes from the task's own runner, which
      // already knows the owning clientId because it's the same
      // scoped wrapper the createTask call ran through. Still
      // belt-and-braces: drop the write if the owner doesn't match.
      if (owners.get(taskId) !== clientId) {
        throw new McpError(ErrorCode.InvalidParams, "Task not found");
      }
      logEvent("task.transition", { taskId, clientId, status });
      await global.storeTaskResult(taskId, status, result, sessionId);
      // The SDK resets its retention timer to now + ttl when the result
      // is stored; reschedule ours to match so the owner can still read
      // the result for the full retention window (not just until the
      // original createTime + ttl).
      scheduleEviction(taskId, clientId, taskTtls.get(taskId) ?? getTasksConfig().defaultTtlMs);
    },

    async getTaskResult(taskId: string, sessionId?: string): Promise<Result> {
      if (owners.get(taskId) !== clientId) {
        throw new McpError(ErrorCode.InvalidParams, "Task not found");
      }
      return global.getTaskResult(taskId, sessionId);
    },

    async updateTaskStatus(
      taskId: string,
      status: Task["status"],
      statusMessage?: string,
      sessionId?: string,
    ): Promise<void> {
      if (owners.get(taskId) !== clientId) {
        throw new McpError(ErrorCode.InvalidParams, "Task not found");
      }
      logEvent("task.transition", { taskId, clientId, status, statusMessage });
      await global.updateTaskStatus(taskId, status, statusMessage, sessionId);
      // Fire the runner-registered AbortController when the SDK's
      // tasks/cancel handler transitions us into `cancelled` — that
      // handler does the status flip but does NOT abort any
      // signal, so without this hook the background batch
      // fan-out runs to completion and the cancellation is purely
      // bookkeeping. With this hook, the runner's batchExecute
      // sees `signal.aborted` between items and stops claiming.
      if (status === "cancelled") {
        const ctrl = abortControllers.get(taskId);
        if (ctrl && !ctrl.signal.aborted) ctrl.abort();
      }
      // Drop the controller reference on any terminal transition;
      // no need to keep aborting nothing.
      if (status === "completed" || status === "failed" || status === "cancelled") {
        abortControllers.delete(taskId);
        // SDK resets its retention timer to now + ttl on terminal
        // transitions; keep our augment-map eviction in lockstep.
        scheduleEviction(taskId, clientId, taskTtls.get(taskId) ?? getTasksConfig().defaultTtlMs);
      }
    },

    async listTasks(
      cursor?: string,
      sessionId?: string,
    ): Promise<{ tasks: Task[]; nextCursor?: string }> {
      // Pull the underlying page, then filter to entries we own.
      // Cursor opacity is preserved: we hand the SDK's cursor back
      // to the caller verbatim, so the next call continues from the
      // SDK's idea of "next page" — not ours. This means a clientId
      // with sparse ownership may get a short page; clients should
      // page until `nextCursor` is absent, which is exactly what
      // the spec already requires.
      const page = await global.listTasks(cursor, sessionId);
      const filtered = page.tasks.filter((t) => owners.get(t.taskId) === clientId);
      return page.nextCursor
        ? { tasks: filtered, nextCursor: page.nextCursor }
        : { tasks: filtered };
    },
  };
}

/**
 * Test/debug helper. Returns a snapshot of the augment map so tests
 * can assert ownership transitions without poking the SDK store
 * internals.
 */
export function _ownersSnapshot(): ReadonlyMap<string, string> {
  return new Map(owners);
}
