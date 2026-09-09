/**
 * HTTP-app integration tests. Builds the express app via `createApp`
 * with a real OAuth provider, starts it on an ephemeral port, and
 * exercises the handler chain via Node's built-in `fetch`. Closes
 * the bottom of the test pyramid for the HTTP transport — until now
 * its handlers were only verified by the smoke-test against the
 * deployed instance in a separate repo.
 *
 * Capsule API isn't reached: the only path that would hit Capsule is
 * `/mcp` after a successful OAuth dance, and we either stop short
 * of that or mock undici.fetch.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { createApp, resolveMcpRateLimitConfig } from "../src/http/app.js";
import { OAuthProvider, FixedClientStore, InMemoryClientsStore } from "../src/auth/provider.js";

vi.mock("undici", () => ({ fetch: vi.fn() }));

// ── Setup: a minimal real provider + app on a random port ────────────────────

const SIGNING_KEY = "x".repeat(32);
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret-32-chars-min";
const REDIRECT_URI = "http://localhost:9999/cb";

// PKCE pair — MCP SDK requires S256
const CODE_VERIFIER = "test-verifier-padding-padding-padding-padding-pad";
const CODE_CHALLENGE = createHash("sha256").update(CODE_VERIFIER).digest("base64url");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env["CAPSULE_API_TOKEN"] = "test-token";

  const provider = new OAuthProvider({
    clientsStore: new FixedClientStore({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUris: [REDIRECT_URI],
      clientName: "test client",
    }),
    signingKey: SIGNING_KEY,
    resourceUrl: new URL("http://localhost/mcp"),
    enableAuthCodeGc: false,
  });

  const app = createApp({
    oauthProvider: provider,
    issuerUrl: new URL("http://localhost"),
    jsonLimit: "1mb",
    allowedOrigins: ["http://localhost", "https://claude.ai"],
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  delete process.env["CAPSULE_API_TOKEN"];
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("OAuth metadata endpoints", () => {
  it("/.well-known/oauth-authorization-server returns 200 with issuer", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["issuer"]).toBeTruthy();
    expect(body["authorization_endpoint"]).toBeTruthy();
    expect(body["token_endpoint"]).toBeTruthy();
  });

  it("does NOT advertise registration_endpoint when in static-client mode (DCR off)", async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["registration_endpoint"]).toBeUndefined();
  });

  it("/.well-known/oauth-protected-resource/mcp advertises /mcp as the resource", async () => {
    // The MCP server lives at /mcp, so per RFC 9728 the
    // protected-resource metadata is published with that path
    // suffix. Bare /.well-known/oauth-protected-resource is
    // intentionally NOT served (it would advertise the issuer root,
    // which isn't a resource).
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Resource URL is built from the configured issuerUrl (not the
    // ephemeral test port), so assert on the path/origin pair rather
    // than the test baseUrl.
    expect(body["resource"]).toBe("http://localhost/mcp");
    expect(body["authorization_servers"]).toBeTruthy();
  });
});

describe("DCR is disabled in static-client mode", () => {
  it("POST /register returns 404", async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe("Negative auth surface on /mcp", () => {
  it("POST /mcp without bearer returns 401 with WWW-Authenticate (incl. resource_metadata)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth.toLowerCase()).toContain("bearer");
    // The metadata URL must be advertised so generic clients can
    // discover the resource server's protected-resource metadata
    // (RFC 9728 §5.1).
    expect(wwwAuth).toContain("resource_metadata=");
    expect(wwwAuth).toContain("/.well-known/oauth-protected-resource/mcp");
  });

  it("POST /mcp rejects invalid browser origins before auth", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("POST /mcp allows configured browser origins through to auth", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://claude.ai",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("POST /mcp authenticates before parsing the JSON body", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with a forged bearer returns 401", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-a-real-token",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("GET /mcp with a valid bearer returns 405 (method not allowed)", async () => {
    // Mint a real token by walking the OAuth dance (briefly).
    const accessToken = await mintToken();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(405);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("method_not_allowed");
  });

  it("GET /mcp with a valid bearer rejects unsupported protocol versions before 405", async () => {
    const accessToken = await mintToken();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "MCP-Protocol-Version": "2099-01-01",
      },
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /mcp with a valid bearer returns 405", async () => {
    const accessToken = await mintToken();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(405);
  });

  it("GET /mcp without bearer returns 401 (auth wired BEFORE 405)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "GET" });
    expect(res.status).toBe(401);
  });
});

describe("/authorize and /token", () => {
  it("/authorize with valid client_id returns 302 with code", async () => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
      state: "test-state",
    });
    const res = await fetch(`${baseUrl}/authorize?${params}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain(REDIRECT_URI);
    expect(location).toContain("code=");
  });

  it("/authorize with wrong client_id returns 4xx", async () => {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: "wrong-client",
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    });
    const res = await fetch(`${baseUrl}/authorize?${params}`, {
      redirect: "manual",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("/token with wrong client_secret returns invalid_client", async () => {
    // Get a code first
    const code = await getAuthCode();

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: "wrong-secret",
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    const res = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["error"]).toBe("invalid_client");
  });

  it("/token with unknown client_id returns invalid_client (constant-time path)", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "doesnt-matter",
      client_id: "never-registered-client",
      client_secret: "x".repeat(CLIENT_SECRET.length),
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    const res = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["error"]).toBe("invalid_client");
  });

  it("/token without client_secret returns invalid_client (no fallthrough to SDK)", async () => {
    const code = await getAuthCode();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    const res = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json["error"]).toBe("invalid_client");
  });

  it("/token still supports DCR public clients with token_endpoint_auth_method=none", async () => {
    const provider = new OAuthProvider({
      clientsStore: new InMemoryClientsStore(),
      signingKey: SIGNING_KEY,
      resourceUrl: new URL("http://localhost/mcp"),
      enableAuthCodeGc: false,
    });
    const app = createApp({
      oauthProvider: provider,
      issuerUrl: new URL("http://localhost"),
      jsonLimit: "1mb",
      allowedOrigins: ["http://localhost"],
    });
    let publicServer: Server | undefined;
    try {
      await new Promise<void>((resolve) => {
        publicServer = app.listen(0, () => resolve());
      });
      const addr = publicServer!.address() as AddressInfo;
      const publicBaseUrl = `http://127.0.0.1:${addr.port}`;

      const registerRes = await fetch(`${publicBaseUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
      expect(registerRes.status).toBe(201);
      const client = (await registerRes.json()) as {
        client_id: string;
        client_secret?: string;
      };
      expect(client.client_secret).toBeUndefined();

      const verifier = "public-client-verifier-padding-padding-padding";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authParams = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const authRes = await fetch(`${publicBaseUrl}/authorize?${authParams}`, {
        redirect: "manual",
      });
      expect(authRes.status).toBe(302);
      const code = new URL(authRes.headers.get("location") ?? "", "http://x").searchParams.get(
        "code",
      );

      const tokenRes = await fetch(`${publicBaseUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code ?? "",
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      expect(tokenRes.status).toBe(200);
      const tokens = (await tokenRes.json()) as { access_token?: string };
      expect(tokens.access_token).toBeTruthy();
    } finally {
      provider.shutdown();
      if (publicServer) {
        await new Promise<void>((resolve, reject) =>
          publicServer!.close((err) => (err ? reject(err) : resolve())),
        );
      }
    }
  });
});

describe("/mcp 500 response is sanitized (does not echo internal err.message)", () => {
  it("returns generic {error: 'internal_error'} with no message field on 500s", async () => {
    // Deterministically trigger our `/mcp` catch block by stubbing the
    // SDK transport to throw. Without this stub, malformed payloads
    // may or may not reach the 500 path depending on SDK behaviour —
    // making the test conditional and effectively non-asserting on the
    // "happy" path. Stubbing forces the failure mode and proves the
    // sanitization holds even when err.message contains internal text.
    const accessToken = await mintToken();
    const transportModule = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const spy = vi
      .spyOn(transportModule.StreamableHTTPServerTransport.prototype, "handleRequest")
      .mockImplementation(async () => {
        throw new Error("internal-detail-that-must-not-leak-to-client: party 12345, tenant abc");
      });
    try {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["error"]).toBe("internal_error");
      expect(body["message"]).toBeUndefined();
      // Also assert the internal-detail string itself doesn't appear
      // anywhere in the response — defends against future regressions
      // that fold err.message into other fields.
      const text = JSON.stringify(body);
      expect(text).not.toContain("internal-detail-that-must-not-leak");
      expect(text).not.toContain("party 12345");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Proxy trust (express-rate-limit behind X-Forwarded-For)", () => {
  it("/authorize succeeds when X-Forwarded-For is present (does not 500)", async () => {
    // Without `app.set('trust proxy', 1)`, express-rate-limit treats
    // X-Forwarded-For as a misconfiguration and the request errors out
    // before the OAuth handler runs. With trust-proxy correctly set,
    // the request should proceed normally — i.e. behave exactly like a
    // direct request: 302 with code on success.
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
      state: "fwd-test",
    });
    const res = await fetch(`${baseUrl}/authorize?${params}`, {
      redirect: "manual",
      headers: { "X-Forwarded-For": "203.0.113.1" },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toContain("code=");
  });
});

describe("/mcp per-client rate limit", () => {
  let lowLimitServer: import("node:http").Server;
  let lowLimitBaseUrl: string;
  const lowLimitSecret = "0123456789abcdef0123456789abcdef";
  const lowLimitClientId = "rl-test-client";

  beforeAll(async () => {
    // Spawn a separate server with a 2-request-per-minute rate limit so
    // we can exercise the 429 path without hammering the default 600/min.
    process.env["MCP_HTTP_RATE_LIMIT_MAX"] = "2";
    process.env["MCP_HTTP_RATE_LIMIT_WINDOW_MS"] = "60000";
    const provider = new OAuthProvider({
      clientsStore: new FixedClientStore({
        clientId: lowLimitClientId,
        clientSecret: lowLimitSecret,
        redirectUris: [REDIRECT_URI],
        clientName: "rate-limit test",
      }),
      signingKey: SIGNING_KEY,
      resourceUrl: new URL("http://localhost/mcp"),
      enableAuthCodeGc: false,
    });
    const app = createApp({
      oauthProvider: provider,
      issuerUrl: new URL("http://localhost"),
      jsonLimit: "1mb",
      allowedOrigins: ["http://localhost"],
    });
    await new Promise<void>((resolve) => {
      lowLimitServer = app.listen(0, () => resolve());
    });
    const addr = lowLimitServer.address() as AddressInfo;
    lowLimitBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    delete process.env["MCP_HTTP_RATE_LIMIT_MAX"];
    delete process.env["MCP_HTTP_RATE_LIMIT_WINDOW_MS"];
    await new Promise<void>((resolve, reject) =>
      lowLimitServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("returns 429 after the configured per-window ceiling", async () => {
    // Mint a token against the low-limit server so the bearer auth gate
    // passes and we actually exercise the rate limiter.
    const verifier = Buffer.from("v".repeat(43)).toString();
    const { createHash } = await import("node:crypto");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: lowLimitClientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "rl",
    });
    const authRes = await fetch(`${lowLimitBaseUrl}/authorize?${params}`, {
      redirect: "manual",
    });
    const code = new URL(authRes.headers.get("location") ?? "", "http://x").searchParams.get(
      "code",
    );
    const tokRes = await fetch(`${lowLimitBaseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        client_id: lowLimitClientId,
        client_secret: lowLimitSecret,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    const token = ((await tokRes.json()) as { access_token: string }).access_token;

    const callMcp = (): Promise<Response> =>
      fetch(`${lowLimitBaseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      });

    // First two within-window calls should pass the limiter (responses
    // may be 200 with a JSON-RPC error inside; we only care that the
    // limiter let them through, i.e. NOT 429).
    const r1 = await callMcp();
    expect(r1.status).not.toBe(429);
    const r2 = await callMcp();
    expect(r2.status).not.toBe(429);
    // Third call within the same window should trip the limiter.
    const r3 = await callMcp();
    expect(r3.status).toBe(429);
    const body = (await r3.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("Too Many Requests");
  });
});

describe("/mcp rate-limit env parsing", () => {
  const keys = [
    "MCP_HTTP_RATE_LIMIT_MAX",
    "MCP_HTTP_RATE_LIMIT_WINDOW_MS",
    "MCP_HTTP_RATE_LIMIT_DISABLED",
  ];

  afterEach(() => {
    for (const key of keys) delete process.env[key];
  });

  it("falls back on malformed or unsafe values before constructing express-rate-limit", () => {
    process.env["MCP_HTTP_RATE_LIMIT_MAX"] = "-1";
    process.env["MCP_HTTP_RATE_LIMIT_WINDOW_MS"] = "-500";
    const cfg = resolveMcpRateLimitConfig();
    expect(cfg.limit).toBe(600);
    expect(cfg.windowMs).toBe(60_000);
  });

  it("clamps windows above Node's timer ceiling", () => {
    process.env["MCP_HTTP_RATE_LIMIT_WINDOW_MS"] = String(2 ** 31 + 1000);
    expect(resolveMcpRateLimitConfig().windowMs).toBe(2 ** 31 - 1);
  });

  it("honours positive overrides and the explicit test-only disable flag", () => {
    process.env["MCP_HTTP_RATE_LIMIT_MAX"] = "7";
    process.env["MCP_HTTP_RATE_LIMIT_WINDOW_MS"] = "12345";
    process.env["MCP_HTTP_RATE_LIMIT_DISABLED"] = "1";
    expect(resolveMcpRateLimitConfig()).toEqual({
      limit: 7,
      windowMs: 12345,
      disabled: true,
    });
  });
});

describe("Icon endpoints (cosmetic)", () => {
  it("/icon.svg returns the SVG with correct content-type", async () => {
    const res = await fetch(`${baseUrl}/icon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
  });

  it("/favicon.ico returns the same SVG (browser-default path)", async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("icon responses include a public 24h Cache-Control", async () => {
    const res = await fetch(`${baseUrl}/icon.svg`);
    const cache = res.headers.get("cache-control");
    expect(cache).toContain("public");
    expect(cache).toContain("max-age=86400");
  });
});

describe("Landing page (cosmetic)", () => {
  // `/` serves a tiny HTML page so browser-style favicon discovery
  // (which walks `<link>` tags in the head) has something to find.
  // Without it, Express's default 404 renders an empty <head> and
  // any client doing HTML-shaped icon discovery (favicon checkers,
  // possibly some connector UIs) gives up. Locking the contract.

  it("GET / returns 200 with HTML content-type", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("response body declares the SVG icon via <link rel='icon'>", async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    // type="image/svg+xml" is the explicit hint that lets browsers
    // skip fetching the icon when they can't render SVG (rare today
    // but the spec rewards being explicit).
    expect(body).toMatch(/<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="\/icon\.svg"/);
  });

  it("response body declares the apple-touch-icon", async () => {
    // iOS home-screen pinning fetches apple-touch-icon by spec name.
    // No semantic difference from the regular icon for SVG, but
    // belt-and-suspenders for the favicon-checker green-row count.
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    expect(body).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/icon\.svg"/);
  });

  it("response body is human-readable (mentions the MCP endpoint)", async () => {
    // If a dev hits the URL in a browser by mistake, they should see
    // *something* useful, not "Cannot GET /". The /mcp anchor is the
    // most concrete next-step a human reader needs.
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    expect(body).toContain("/mcp");
    expect(body).toMatch(/capsulemcp/i);
  });

  it("landing page has a 1h Cache-Control (shorter than the icon's 24h)", async () => {
    // Page text might evolve as we polish copy; 1h means a fix
    // propagates the same day. Icon bytes change ~never, hence 24h.
    const res = await fetch(`${baseUrl}/`);
    const cache = res.headers.get("cache-control");
    expect(cache).toContain("public");
    expect(cache).toContain("max-age=3600");
  });

  it("no template interpolation surfaces — body bytes match across requests", async () => {
    // Defensive: catches an accidental refactor that introduces e.g.
    // ${requestId} into the response. Two requests must produce
    // identical bytes (modulo gzip variation, which fetch handles).
    const a = await (await fetch(`${baseUrl}/`)).text();
    const b = await (await fetch(`${baseUrl}/`)).text();
    expect(a).toBe(b);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthCode(): Promise<string> {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    resource: "http://localhost/mcp",
  });
  const res = await fetch(`${baseUrl}/authorize?${params}`, {
    redirect: "manual",
  });
  const location = res.headers.get("location")!;
  const match = location.match(/code=([^&]+)/);
  if (!match) throw new Error(`no code in redirect: ${location}`);
  return match[1]!;
}

async function mintToken(): Promise<string> {
  const code = await getAuthCode();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code_verifier: CODE_VERIFIER,
    resource: "http://localhost/mcp",
  });
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

describe("/token authentication rate limiting", () => {
  it.each([
    ["wrong secret", { client_id: CLIENT_ID, client_secret: "wrong" }, "/token"],
    ["unknown client", { client_id: "unknown", client_secret: "wrong" }, "/token"],
    ["missing credentials", {}, "/token"],
    ["unknown subpath", { client_id: CLIENT_ID, client_secret: "wrong" }, "/token/unknown"],
  ])("counts %s attempts before authentication", async (_label, credentials, path) => {
    const provider = new OAuthProvider({
      clientsStore: new FixedClientStore({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUris: [REDIRECT_URI],
      }),
      signingKey: SIGNING_KEY,
      resourceUrl: "http://localhost/mcp",
      enableAuthCodeGc: false,
    });
    const app = createApp({
      oauthProvider: provider,
      issuerUrl: new URL("http://localhost"),
      jsonLimit: "1mb",
      allowedOrigins: [],
      trustProxy: false,
    });
    const localServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      localServer.once("listening", resolve);
      localServer.once("error", reject);
    });
    const localUrl = `http://127.0.0.1:${(localServer.address() as AddressInfo).port}`;
    const postToken = (body: Record<string, string>, target = "/token") =>
      fetch(`${localUrl}${target}`, {
        method: "POST",
        body: new URLSearchParams(body),
      });
    try {
      for (let i = 0; i < 49; i++) {
        const response = await postToken(credentials as Record<string, string>, path);
        expect(response.status).toBe(path === "/token" ? 401 : 400);
        expect(await response.json()).toMatchObject({ error: "invalid_client" });
      }
      const authorize = await fetch(
        `${localUrl}/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          code_challenge: CODE_CHALLENGE,
          code_challenge_method: "S256",
        })}`,
        { redirect: "manual" },
      );
      const code = new URL(authorize.headers.get("location")!).searchParams.get("code")!;
      await authorize.text();
      // The last request in the budget can still complete a real exchange.
      const valid = await postToken({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: CODE_VERIFIER,
        redirect_uri: REDIRECT_URI,
      });
      expect(valid.status).toBe(200);
      expect(valid.headers.get("ratelimit-remaining")).toBe("0");
      expect(((await valid.json()) as { access_token: string }).access_token).toBeTruthy();
      const blocked = await postToken(credentials as Record<string, string>, path);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
      expect(blocked.headers.get("access-control-allow-origin")).toBe("*");
      expect(await blocked.json()).toMatchObject({ error: "too_many_requests" });
    } finally {
      provider.shutdown();
      await new Promise<void>((resolve, reject) =>
        localServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
