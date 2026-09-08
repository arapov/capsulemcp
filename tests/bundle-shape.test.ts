/**
 * Bundle-shape canary tests.
 *
 * These assertions run against the built artifacts in `dist/`, not the
 * TypeScript source. They catch a small set of release-blocking
 * regressions that the unit tests (which import from `src/`) cannot
 * see:
 *
 *   - The stdio entry (`dist/index.js`) must start with the
 *     `#!/usr/bin/env node` shebang. Without it, `npx capsulemcp`
 *     errors at spawn-time on Unix.
 *   - The HTTP entry (`dist/http.js`) must NOT have a shebang — it is
 *     not invoked as a CLI and a stray shebang would render the file
 *     as text in some loaders.
 *   - Both entries are reasonable size (sanity check, not a hard cap).
 *
 * Existing pre-release checklist items (HOWTO) cover bundle size
 * reporting in docs; this test pins the shebang invariant which is
 * checked nowhere else.
 *
 * The build is not run from this test — CI and the pre-release gate
 * run `npm run build` before `npm test`. If `dist/` is missing in a
 * quick local unit-test loop, this test skips rather than failing;
 * running tests against an unbuilt tree is a developer-experience
 * choice, not an error.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIST = new URL("../dist/", import.meta.url);
const STDIO_PATH = new URL("index.js", DIST);
const HTTP_PATH = new URL("http.js", DIST);

const SHEBANG = "#!/usr/bin/env node";
const MIN_KB = 50;
const MAX_KB = 300;

const distExists = existsSync(STDIO_PATH) && existsSync(HTTP_PATH);

describe.skipIf(!distExists)("bundle shape (post-build canary)", () => {
  it("dist/index.js (stdio entry) starts with a Node shebang", () => {
    const text = readFileSync(STDIO_PATH, "utf-8");
    expect(text.slice(0, SHEBANG.length)).toBe(SHEBANG);
  });

  it("dist/http.js (HTTP entry) does NOT start with a shebang", () => {
    const text = readFileSync(HTTP_PATH, "utf-8");
    expect(text.startsWith("#!")).toBe(false);
  });

  it("both bundles are in a reasonable size band", () => {
    const stdioKb = statSync(STDIO_PATH).size / 1024;
    const httpKb = statSync(HTTP_PATH).size / 1024;
    // Floor catches "the bundler produced an empty file"; ceiling
    // catches "we accidentally inlined a giant dependency". The
    // current values (~183 / ~210 KB) sit comfortably in the band.
    expect(stdioKb).toBeGreaterThan(MIN_KB);
    expect(stdioKb).toBeLessThan(MAX_KB);
    expect(httpKb).toBeGreaterThan(MIN_KB);
    expect(httpKb).toBeLessThan(MAX_KB);
  });
});
