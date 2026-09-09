/**
 * Express app factory for the HTTP transport. Pure — takes a fully
 * constructed OAuth provider and config, returns an `express.Express`
 * instance. Doesn't call `app.listen()` itself; the caller decides
 * when to start serving (or not, in tests).
 *
 * Lives in its own module so tests can import it without triggering
 * the side effects in `src/http.ts` (env validation, process.exit on
 * missing config, app.listen).
 */

import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import type { OAuthProvider } from "../auth/provider.js";
import { readPositiveInt } from "../env.js";
import { createCapsuleMcpServer } from "../server.js";
import { ICON_SVG } from "../icon.js";
import { withRequestContext } from "../log.js";

export interface AppOptions {
  oauthProvider: OAuthProvider;
  issuerUrl: URL;
  jsonLimit: string;
  allowedOrigins: string[];
  resourceName?: string;
  /**
   * Express `trust proxy` setting. Required when running behind a
   * reverse proxy that injects `X-Forwarded-For` (e.g. Cloud Run, an
   * nginx ingress). The MCP SDK's auth router applies
   * `express-rate-limit` to /authorize, /token, and /register; with
   * the default `trust proxy=false`, express-rate-limit treats the
   * presence of `X-Forwarded-For` as a misconfiguration and may
   * refuse the request.
   *
   * Defaults to `1` (trust the immediately-upstream proxy), which is
   * correct for Cloud Run and most single-hop ingress setups. Set to
   * `false` to disable, or to a higher integer if there are multiple
   * proxy hops in front of the server.
   */
  trustProxy?: boolean | number | string;
}

function secretDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function timingSafeSecretEqual(provided: string, expected: string): boolean {
  // Compare fixed-width digests so the equality check doesn't branch on
  // the raw client_secret length before timingSafeEqual runs.
  return timingSafeEqual(secretDigest(provided), secretDigest(expected));
}

const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MCP_RATE_LIMIT_MAX = 600;
const MAX_MEMORY_STORE_WINDOW_MS = 2 ** 31 - 1;

export function resolveMcpRateLimitConfig(): {
  windowMs: number;
  limit: number;
  disabled: boolean;
} {
  // express-rate-limit's default MemoryStore backs `windowMs` with
  // setInterval, so over-large or negative values get coerced by Node
  // timers after only a logged validation error. Parse defensively here
  // so operator typos fall back or clamp before they reach the store.
  const windowMs = Math.min(
    readPositiveInt("MCP_HTTP_RATE_LIMIT_WINDOW_MS", DEFAULT_MCP_RATE_LIMIT_WINDOW_MS),
    MAX_MEMORY_STORE_WINDOW_MS,
  );
  return {
    windowMs,
    limit: readPositiveInt("MCP_HTTP_RATE_LIMIT_MAX", DEFAULT_MCP_RATE_LIMIT_MAX),
    disabled: process.env["MCP_HTTP_RATE_LIMIT_DISABLED"] === "1",
  };
}

export function createApp(opts: AppOptions): express.Express {
  const { oauthProvider, issuerUrl, jsonLimit, allowedOrigins } = opts;
  const resourceName = opts.resourceName ?? "Capsule CRM MCP";
  const trustProxy = opts.trustProxy ?? 1;

  // The MCP server lives at /mcp under the issuer. Advertise its
  // path-specific protected-resource metadata at
  // /.well-known/oauth-protected-resource/mcp, and include the
  // metadata URL in WWW-Authenticate on /mcp's 401s so generic
  // OAuth/MCP clients can discover it without baked-in knowledge.
  const mcpResourceUrl = new URL("/mcp", issuerUrl);
  const mcpResourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpResourceUrl);

  const app = express();
  // MUST be set before mcpAuthRouter so the rate-limit middleware
  // inside the SDK's auth router sees the configured trust setting.
  app.set("trust proxy", trustProxy);

  // Charge every token attempt before credential checks can return early.
  // Replace the SDK's downstream limiter (disabled below), retaining its
  // default per-IP budget and OAuth error shape.
  app.use(
    "/token",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 50,
      standardHeaders: true,
      legacyHeaders: false,
      // Cover the whole mounted router: even unknown subpaths reach the
      // SDK's client-auth middleware. Preflight/non-POST requests do not.
      skip: (req) => req.method !== "POST",
      handler: (_req, res) => {
        // Match the SDK token router's public CORS policy on throttled
        // responses too, so browser clients can read the OAuth error.
        res.set("Access-Control-Allow-Origin", "*").status(429).json({
          error: "too_many_requests",
          error_description: "You have exceeded the rate limit for token requests",
        });
      },
    }),
  );

  // Constant-time client_secret pre-check on /token. Mounted BEFORE
  // mcpAuthRouter so we authenticate the client first; the SDK's own
  // client-auth (which uses native `!==` and is therefore not
  // constant-time) then runs on a known-valid secret, closing the
  // timing channel for invalid-secret attackers.
  //
  // For secret-bearing clients, reads client_secret_post only (form body).
  // The SDK's downstream auth doesn't support client_secret_basic, so
  // supporting it here would create a half-working path. The
  // FixedClientStore default of `token_endpoint_auth_method:
  // "client_secret_post"` is what static-client callers actually use.
  //
  // Wrapped as URL-encoded middleware because mcpAuthRouter installs
  // its own body parser internally; we need access to req.body here,
  // so we duplicate the small parse. Both parses are idempotent.
  app.post("/token", express.urlencoded({ extended: false }), async (req, res, next) => {
    const sendInvalidClient = (description: string): void => {
      res.status(401).json({
        error: "invalid_client",
        error_description: description,
      });
    };

    const body = (req.body ?? {}) as Record<string, unknown>;
    const clientId = typeof body["client_id"] === "string" ? body["client_id"] : undefined;
    const providedSecret =
      typeof body["client_secret"] === "string" ? body["client_secret"] : undefined;

    if (!clientId) {
      sendInvalidClient("client credentials required");
      return;
    }

    let expected: Awaited<ReturnType<typeof oauthProvider.clientsStore.getClient>>;
    try {
      expected = await oauthProvider.clientsStore.getClient(clientId);
    } catch {
      res.status(500).json({
        error: "server_error",
        error_description: "client lookup failed",
      });
      return;
    }

    // Always run a fixed-width digest comparison before branching on
    // whether the client exists. Otherwise an attacker could distinguish
    // "unknown clientId" from "known clientId, wrong secret" by timing.
    const expectedSecret =
      expected && typeof expected.client_secret === "string" && expected.client_secret
        ? expected.client_secret
        : "";
    const secretsMatch = timingSafeSecretEqual(providedSecret ?? "", expectedSecret);
    if (!expected) {
      sendInvalidClient("client authentication failed");
      return;
    }

    // Public DCR clients (`token_endpoint_auth_method: "none"`) have no
    // client_secret. Let the SDK's downstream auth middleware handle that
    // standards path; the pre-check only replaces secret-bearing compares.
    if (!expectedSecret) {
      next();
      return;
    }

    const expiresAt = expected.client_secret_expires_at;
    const secretExpired =
      typeof expiresAt === "number" && expiresAt !== 0 && expiresAt < Math.floor(Date.now() / 1000);
    if (providedSecret === undefined || !secretsMatch || secretExpired) {
      sendInvalidClient("client authentication failed");
      return;
    }
    next();
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      scopesSupported: [],
      resourceName,
      resourceServerUrl: mcpResourceUrl,
      tokenOptions: { rateLimit: false },
    }),
  );

  // ── Icon (cosmetic) ──────────────────────────────────────────────────────
  // Some connector UIs prefer fetching an icon over a URL rather than reading
  // it from the MCP serverInfo payload. Serve our SVG at both /icon.svg and
  // /favicon.ico (browsers default-fetch the latter). 24h cache — the icon
  // rotates approximately never.
  const iconHandler = (_req: express.Request, res: express.Response): void => {
    res
      .set("Content-Type", "image/svg+xml")
      .set("Cache-Control", "public, max-age=86400")
      .send(ICON_SVG);
  };
  app.get("/icon.svg", iconHandler);
  app.get("/favicon.ico", iconHandler);

  // ── Landing page (cosmetic) ──────────────────────────────────────────────
  // Browser-style favicon discovery walks the `<link>` tags in the HTML head
  // at `/`. Without a real HTML response, Express's default 404 page renders
  // with an empty <head>, and any client doing browser-shaped icon discovery
  // (favicon checkers, possibly Claude.ai's connector UI) gives up there.
  //
  // This route serves a tiny static page that:
  //   - Declares the SVG icon via <link rel="icon"> + apple-touch-icon
  //   - Tells human visitors what this URL is and where the MCP endpoint
  //     lives (so a curious dev hitting the URL in a browser doesn't see
  //     "Cannot GET /" and assume the service is down)
  //
  // Static bytes — no user input, no template interpolation, no XSS surface.
  // Generic content only (no deployment-specific URLs or tenant info).
  // 1h cache so an icon refresh propagates within a reasonable window.
  const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>capsulemcp</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<meta name="description" content="Model Context Protocol server for Capsule CRM. MCP endpoint: /mcp">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:42em;margin:3em auto;padding:0 1em;color:#222;line-height:1.5}
h1{font-size:1.6em;margin-bottom:0.2em}
code{background:#f3f3f3;padding:0.1em 0.35em;border-radius:3px;font-size:0.95em}
a{color:#1e3a8a}
.muted{color:#666;font-size:0.92em}
</style>
</head>
<body>
<h1>capsulemcp</h1>
<p>This is the HTTP+OAuth deployment of <a href="https://github.com/soil-dev/capsulemcp">capsulemcp</a>, a Model Context Protocol (MCP) server for Capsule CRM.</p>
<p>The MCP endpoint is at <code>/mcp</code>. Use Claude.ai's Custom Connector flow (or any MCP-compatible client) to connect &mdash; this URL is not navigable by hand.</p>
<p class="muted">Source: <a href="https://github.com/soil-dev/capsulemcp">github.com/soil-dev/capsulemcp</a> &middot; License: Apache-2.0</p>
</body>
</html>
`;
  app.get("/", (_req, res) => {
    res
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=3600")
      .send(LANDING_HTML);
  });

  // ── MCP endpoint (gated by Bearer token from the OAuth provider) ─────────
  const guardOrigin: express.RequestHandler = (req, res, next) => {
    const origin = req.get("Origin");
    if (!origin) {
      next();
      return;
    }
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid Origin header" },
        id: null,
      });
      return;
    }
    if (!allowedOrigins.includes(normalizedOrigin)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Origin is not allowed" },
        id: null,
      });
      return;
    }
    next();
  };

  // Per-client rate limit on /mcp. Keyed by the authenticated clientId
  // (set by requireBearerAuth onto req.auth) so one abusive caller can't
  // exhaust the shared Capsule API quota for everyone else on the same
  // deployment. The window/ceiling here are intentionally generous —
  // enough that a normal Claude session won't ever notice, low enough
  // that a runaway loop trips before the upstream 4000-rph cap.
  // Operators on heavy-tenant deployments can override via env. Tests
  // disable it via MCP_HTTP_RATE_LIMIT_DISABLED.
  const {
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    disabled: rateLimitDisabled,
  } = resolveMcpRateLimitConfig();
  const mcpRateLimit = rateLimit({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const clientId = req.auth?.clientId;
      if (clientId) return clientId;
      // Fallback to IP for unauthenticated paths (shouldn't reach here
      // post-requireBearerAuth, but defensive). Use express-rate-limit's
      // ipKeyGenerator helper rather than `req.ip` directly: it groups
      // IPv6 addresses to a /64 prefix so a single client can't rotate
      // through its subnet to bypass the per-IP bucket. `req.ip` respects
      // the trust-proxy setting we already configure.
      return ipKeyGenerator(req.ip ?? "");
    },
    skip: () => rateLimitDisabled,
    handler: (_req, res) => {
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too Many Requests" },
        id: null,
      });
    },
  });

  const guardProtocolVersion: express.RequestHandler = (req, res, next) => {
    const protocolVersion = req.get("MCP-Protocol-Version");
    if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: `Bad Request: Unsupported protocol version: ${protocolVersion}`,
        },
        id: null,
      });
      return;
    }
    next();
  };

  // One guard chain for every /mcp verb — origin check, bearer auth,
  // per-client rate limit, protocol-version check — built once so the
  // three routes can't drift apart.
  const mcpGuards: express.RequestHandler[] = [
    guardOrigin,
    requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: mcpResourceMetadataUrl,
    }),
    mcpRateLimit,
    guardProtocolVersion,
  ];

  const methodNotAllowed: express.RequestHandler = (_req, res) => {
    res.set("Allow", "POST").status(405).json({
      error: "method_not_allowed",
      message: "Use POST for MCP requests; this server runs in stateless mode.",
    });
  };

  app.post("/mcp", ...mcpGuards, express.json({ limit: jsonLimit }), async (req, res) => {
    try {
      // Forward the authenticated OAuth client_id so the McpServer
      // factory can scope its task store to this caller. Without
      // this, the in-memory tasks subsystem would be globally
      // readable across clients (see src/tasks/store.ts). The
      // requireBearerAuth middleware above guarantees `req.auth`
      // is populated before we reach here.
      const clientId = req.auth?.clientId;
      const server = createCapsuleMcpServer({ clientId });
      const transport = new StreamableHTTPServerTransport({});

      res.on("close", () => {
        void transport.close();
        void server.close();
      });

      // Per-request observability frame. `tool.call`,
      // `capsule.request`, and `cache.hit` events emitted within
      // implicitly populate the chain accumulator; `tool.chain`
      // is emitted by `withRequestContext` on scope exit (success
      // OR error). AsyncLocalStorage propagates through every
      // await the handler chain spawns, so this catches the
      // synchronous tool-call path AND the SDK's auto-poll
      // fallback for task-augmented tools. Augmented (with
      // `params.task`) callers see a short chain since the actual
      // handler work runs in a void IIFE that outlives this
      // frame — that's by design; the IIFE's standalone
      // `tool.call` event carries the clientId for post-hoc
      // joining.
      await withRequestContext({ clientId }, async () => {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      });
    } catch (err) {
      // Log a low-cardinality summary to stderr (operator-visible) but
      // return only a generic shape to the caller. The full err.message
      // can include Capsule response bodies (party names, validation
      // strings, ...) which is operator-visible PII we don't want
      // smearing across log aggregators by default. Set
      // MCP_HTTP_DEBUG=1 to opt in to the verbose form on this path.
      const name = err instanceof Error ? err.name : typeof err;
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status)
          : undefined;
      const summary = status !== undefined ? `${name} ${status}` : name;
      if (process.env["MCP_HTTP_DEBUG"] === "1") {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[capsulemcp] /mcp error: ${summary} — ${message}`);
      } else {
        console.error(`[capsulemcp] /mcp error: ${summary}`);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_error" });
      }
    }
  });

  app.get("/mcp", ...mcpGuards, methodNotAllowed);
  app.delete("/mcp", ...mcpGuards, methodNotAllowed);

  return app;
}
