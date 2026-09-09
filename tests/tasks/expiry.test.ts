import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { fetch } from "undici";
import { createCapsuleMcpServer } from "../../src/server.js";
import { createScopedTaskStore, _resetTaskStoreForTests } from "../../src/tasks/store.js";

vi.mock("undici", () => ({ fetch: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  _resetTaskStoreForTests();
});

it.each(["per-client", "total"])(
  "expiry stops queued writes and retains the %s quota until completion",
  async (quota) => {
    vi.stubEnv("MCP_TASKS_ENABLED", "1");
    vi.stubEnv("CAPSULE_API_TOKEN", "test-token");
    vi.stubEnv("CAPSULE_MCP_READONLY", "0");
    vi.stubEnv("CAPSULE_MCP_BATCH_CONCURRENCY", "1");
    vi.stubEnv("MCP_TASKS_MAX_PER_CLIENT", quota === "per-client" ? "1" : "20");
    vi.stubEnv("MCP_TASKS_MAX_TOTAL", quota === "total" ? "1" : "200");
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let requests = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      requests++;
      if (requests === 1) await first;
      return new Response(JSON.stringify({ task: { id: requests, status: "COMPLETED" } }), {
        headers: { "content-type": "application/json" },
      }) as Awaited<ReturnType<typeof fetch>>;
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client(
      { name: "expiry-test", version: "1" },
      {
        capabilities: { tasks: { list: {}, cancel: {} } },
      },
    );
    const server = createCapsuleMcpServer({ clientId: "test-client" });
    // Exercise the same-client quota and the global quota from another client.
    const store = createScopedTaskStore(quota === "per-client" ? "test-client" : "other-client");
    const createAnother = () =>
      store.createTask({ ttl: 60_000 }, 99, {
        method: "tools/call",
        params: { name: "noop", arguments: {} },
      });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const created = await client.request(
        {
          method: "tools/call",
          params: {
            name: "batch_complete_task",
            arguments: { ids: [1, 2, 3] },
            task: { ttl: 1000 },
          },
        },
        z.object({ task: z.object({ taskId: z.string() }) }),
      );
      await vi.waitFor(() => expect(requests).toBe(1));
      const taskId = created.task.taskId;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(
        client.request({ method: "tasks/get", params: { taskId } }, z.any()),
      ).rejects.toThrow();
      await expect(
        client.request({ method: "tasks/cancel", params: { taskId } }, z.any()),
      ).rejects.toThrow();
      await expect(createAnother()).rejects.toThrow(/Task quota exceeded/);
      releaseFirst();
      // The runner releases its reservation only after the held write settles.
      await vi.waitFor(async () => {
        const task = await createAnother();
        expect(task.taskId).toBeTruthy();
      });
      expect(requests).toBe(1);
    } finally {
      releaseFirst();
      await client.close();
      await server.close();
    }
  },
);
