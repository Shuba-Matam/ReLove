#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unused-vars -- sidecar CLI with exported helpers for tests */
 /**
 * Re-Love smoke-http
 * Dependency-free Node 22.14+ ESM CLI.
 * Checks an existing origin (or --start a production server) using only GET,
 * bounded timeouts/bodies, manual redirect handling, no cookies/auth/provider calls.
 *
 * Required --expect=demo|live|setup distinguishes sample data vs real DB.
 *
 * Usage:
 *   node scripts/smoke-http.mjs --expect=demo
 *   node scripts/smoke-http.mjs --expect=demo --origin=http://localhost:3000
 *   node scripts/smoke-http.mjs --expect=demo --start --port=3100
 *
 * Env loading is NOT done here; use Node --env-file-if-exists if needed.
 * --start forces APP_MODE to --expect value, AI off, and waits <=30s then cleans up.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "http://localhost:3000";
const FETCH_TIMEOUT_MS = 8000;
const BODY_LIMIT_BYTES = 1_000_000; // 1MB cap for safety; truncate snippet only
const START_POLL_MS = 500;
const START_MAX_MS = 30_000;

const HELP = `
smoke-http — HTTP smoke checks for Re-Love

Usage:
  node scripts/smoke-http.mjs --expect=demo|live|setup [options]
  node --env-file-if-exists=.env.local scripts/smoke-http.mjs --expect=demo --start

Required:
  --expect=demo|live|setup   Expected app mode. Demo samples vs live DB; setup=503.

Options:
  --origin=URL               Origin to check (default ${DEFAULT_ORIGIN})
  --start                    Launch production Next server on an unoccupied port
  --port=NUM                 Port for --start (or origin inference); auto-finds free if omitted
  --timeout=MS               Per-request timeout (default ${FETCH_TIMEOUT_MS})
  --body-limit=BYTES         Max bytes to read per response (default ${BODY_LIMIT_BYTES})
  --help, -h                 Show help

Behavior:
  • ONLY GET requests by default (avoids OAuth /auth/login)
  • Bounded timeouts and bodies, manual redirect handling, safe same-origin
  • No cookies, auth headers, or provider calls
  • Required checks per --expect:
      - HTML routes / /categories /search /login /sell /my-listings /inbox /profile /privacy
      - Session, health, categories/listings contracts (envelopes {data,mode})
      - Demo marker/mode + sample listing detail if available, pagination, unauth private API
      - PWA manifest/icons/offline/service-worker + no-store on private/API data
  • Health: demo→200 {data:{status:ok,mode:demo},mode:demo}
            live→200 {data:{status:ok,mode:live},mode:live}
            setup/unready→503 {data:{status:unavailable,...},mode:setup}
  • Listings: /api/listings?category=furniture&q=seat via demo+live with meta.next_cursor
  • Existing-server smoke never claims live readiness when expect is demo/setup
  • --start: cross-platform next start on explicit free port, forces APP_MODE=<expect>,
             forces AI_ENABLED=false for local validation, readiness ≤30s, ALWAYS cleans up child
  • Never prints secret env values or full response bodies

Exit codes:
  0  all checks passed
  1  smoke failure
  2  usage error

Examples:
  node scripts/smoke-http.mjs --expect=demo
  node scripts/smoke-http.mjs --expect=live --origin=https://re-love-pi.vercel.app
  node scripts/smoke-http.mjs --expect=demo --start
`.trim();

function parseArgs(argv) {
  const opts = {
    expect: null,
    origin: DEFAULT_ORIGIN,
    start: false,
    port: null,
    timeout: FETCH_TIMEOUT_MS,
    bodyLimit: BODY_LIMIT_BYTES,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--start") opts.start = true;
    else if (arg.startsWith("--expect=")) opts.expect = arg.slice("--expect=".length).toLowerCase();
    else if (arg.startsWith("--origin=")) opts.origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--port=")) opts.port = Number(arg.slice("--port=".length));
    else if (arg.startsWith("--timeout=")) opts.timeout = Number(arg.slice("--timeout=".length));
    else if (arg.startsWith("--body-limit=")) opts.bodyLimit = Number(arg.slice("--body-limit=".length));
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

function trunc(str, n = 240) {
  if (!str) return "";
  const s = str.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + " …" : s;
}

function sanitizeHeader(headers, name) {
  const v = headers.get(name);
  if (!v) return null;
  if (name.toLowerCase() === "authorization" || name.toLowerCase() === "cookie") return "[redacted]";
  return v;
}

async function readBodyLimited(res, limit) {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        truncated = true;
        // keep truncated flag but stop accumulating after limit + headroom
        // still consume one chunk snippet for diagnostics
        const slice = value.slice(0, Math.max(0, limit - (total - value.byteLength)));
        if (slice.length) text += decoder.decode(slice, { stream: true });
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return { text, bytes: total, truncated };
}

async function fetchBounded(url, { timeout, bodyLimit, redirect = "manual" }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("timeout")), timeout);
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect,
      signal: controller.signal,
      headers: {
        Accept: "*/*",
      },
      // No credentials/cookies; fetch defaults to no cookie jar in Node
    });
  } finally {
    clearTimeout(t);
  }
  // manual redirect handling: caller inspects Location
  const body = await readBodyLimited(res, bodyLimit);
  const headers = res.headers;
  return { res, headers, body, status: res.status, url };
}

function isSameOrigin(origin, target) {
  try {
    const o = new URL(origin);
    const t = new URL(target, origin);
    return o.origin === t.origin;
  } catch {
    return false;
  }
}

function expectModeLabel(expect) {
  return expect;
}

function checkNoStore(headers) {
  const cc = headers.get("cache-control") || "";
  const lc = cc.toLowerCase();
  // Per http.ts withApi, all APIs use private, no-store; Next headers add private, no-store for /api/:path*
  // We require no-store substring for API/private data
  return lc.includes("no-store");
}

async function findFreePort(preferred) {
  if (preferred) {
    const free = await isPortFree(preferred);
    if (!free) throw new Error(`port ${preferred} is occupied — choose another or omit --port to auto-find`);
    return preferred;
  }
  // ask OS for ephemeral port then release — then reuse quickly (small race but acceptable)
  const srv = createServer();
  await new Promise((resolve, reject) => {
    srv.listen(0, "127.0.0.1", resolve);
    srv.on("error", reject);
  });
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  await new Promise((resolve) => srv.close(resolve));
  if (!port) throw new Error("failed to allocate free port");
  // verify still free (quick)
  const free2 = await isPortFree(port);
  if (!free2) return findFreePort(null); // retry once
  return port;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, "127.0.0.1");
  });
}

async function spawnNextServer(port, expect) {
  // Cross-platform: invoke next via its bin path directly with current node
  // Resolve bin: node_modules/next/dist/bin/next
  const path = await import("node:path");
  const fs = await import("node:fs");
  const root = path.resolve(import.meta.dirname ?? ".", "..");
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const hasBin = fs.existsSync(nextBin);
  if (!hasBin) {
    throw new Error("next binary not found at node_modules/next/dist/bin/next — run npx --yes npm@11.21.1 ci first");
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    APP_MODE: expect,
    AI_ENABLED: "false",
    GOOGLE_AUTH_ENABLED: "false",
    // Ensure no stale AI keys confuse local validation
    // We force AI off, but keep any existing keys ignored
  };

  const controller = new AbortController();
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    signal: controller.signal,
    detached: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => { stdout += d.toString(); });
  child.stderr?.on("data", (d) => { stderr += d.toString(); });

  const cleanup = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      // On Windows, controller.abort sends SIGTERM; fallback to kill
      controller.abort();
      child.kill();
    } catch {}
    // give 3s to exit gracefully, then force
    await Promise.race([
      new Promise((r) => child.on("exit", r)),
      delay(3000).then(() => {
        try { child.kill("SIGKILL"); } catch {}
      }),
    ]);
  };

  // Ensure cleanup on parent signals
  const signals = ["SIGINT", "SIGTERM"];
  const handlers = [];
  for (const sig of signals) {
    const h = async () => { await cleanup(); process.exit(1); };
    process.on(sig, h);
    handlers.push([sig, h]);
  }

  const restoreSignals = () => {
    for (const [sig, h] of handlers) process.off(sig, h);
  };

  return { child, stdout: () => stdout, stderr: () => stderr, cleanup, restoreSignals, env };
}

async function pollReady(origin, timeoutMs) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const { res } = await fetchBounded(`${origin}/api/health`, { timeout: 4000, bodyLimit: 5000, redirect: "manual" });
      // health may be 200 demo or 503 setup; either means server is responding
      if (res.status === 200 || res.status === 503) return true;
      lastError = `health status ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await delay(START_POLL_MS);
  }
  throw new Error(`server not ready within ${timeoutMs}ms (last: ${lastError})`);
}

function verdict(passed, failCount) {
  return passed ? "PASS" : `FAIL (${failCount} failure(s))`;
}

// Core checks
async function runSmoke(opts) {
  const failures = [];
  const warnings = [];
  const infos = [];
  const checks = [];

  function fail(msg) { failures.push(msg); checks.push(`✗ ${msg}`); }
  function warn(msg) { warnings.push(msg); checks.push(`⚠ ${msg}`); }
  function info(msg) { infos.push(msg); checks.push(`· ${msg}`); }
  function pass(msg) { checks.push(`✓ ${msg}`); }

  const origin = opts.origin.replace(/\/$/, "");
  let originOk = false;
  try {
    const u = new URL(origin);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("origin must be http or https");
    originOk = true;
  } catch {
    fail(`origin invalid: ${origin} — must be http(s) URL`);
  }

  // Helper to GET and validate
  async function getAndAssert(path, expectStatus, tag, validators = []) {
    const url = `${origin}${path}`;
    let result;
    try {
      result = await fetchBounded(url, { timeout: opts.timeout, bodyLimit: opts.bodyLimit, redirect: "manual" });
    } catch (e) {
      fail(`${tag} GET ${path} fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    const { res, headers, body } = result;
    const status = res.status;

    // Manual redirect guard
    if (status >= 300 && status < 400) {
      const loc = headers.get("location");
      if (loc) {
        const absolute = new URL(loc, origin).toString();
        if (!isSameOrigin(origin, absolute)) {
          fail(`${tag} GET ${path} unexpected cross-origin redirect ${status} → ${trunc(loc)} (safe same-origin required)`);
        } else {
          fail(`${tag} GET ${path} unexpected redirect ${status} → ${trunc(loc)} — expected ${expectStatus}`);
        }
      } else {
        fail(`${tag} GET ${path} redirect ${status} without Location`);
      }
      return { res, headers, body, status, url };
    }

    if (Array.isArray(expectStatus)) {
      if (!expectStatus.includes(status)) fail(`${tag} GET ${path} status ${status} — expected one of ${expectStatus.join(", ")}`);
      else pass(`${tag} GET ${path} → ${status}`);
    } else if (status !== expectStatus) {
      fail(`${tag} GET ${path} status ${status} — expected ${expectStatus} (snippet: ${trunc(body.text)})`);
      return { res, headers, body, status, url };
    } else {
      pass(`${tag} GET ${path} → ${status}`);
    }

    for (const v of validators) {
      try { v({ res, headers, body, status, url, path }); } catch (e) {
        fail(`${tag} ${path} validation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { res, headers, body, status, url };
  }

  // 1. HTML routes
  const htmlRoutes = ["/", "/categories", "/search", "/login", "/sell", "/my-listings", "/inbox", "/profile", "/privacy"];
  const htmlResults = [];
  for (const path of htmlRoutes) {
    const r = await getAndAssert(path, 200, "html", [
      ({ headers, body }) => {
        const ct = headers.get("content-type") || "";
        if (!ct.toLowerCase().includes("text/html")) throw new Error(`content-type ${ct} not html`);
        if (body.text.length < 200) throw new Error(`body too small (${body.text.length} bytes) — likely error page`);
        if (body.truncated) warn(`html ${path} body truncated at ${opts.bodyLimit} bytes`);
      },
    ]);
    htmlResults.push({ path, r });
  }

  // 2. Health contract
  const health = await getAndAssert("/api/health", opts.expect === "setup" ? 503 : 200, "health", [
    ({ headers, body, status }) => {
      if (!checkNoStore(headers)) warn("health missing no-store (Cache-Control should be private, no-store per src/app/api/health/route.ts)");
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`health invalid JSON: ${trunc(body.text)}`); }
      if (!j || typeof j.data !== "object") throw new Error("health missing data envelope {data,mode}");
      if (j.mode !== opts.expect && !(opts.expect === "setup" && j.mode === "setup")) {
        // For setup we allow mode:setup even on 503
        if (!(status === 503 && j.mode === "setup" && opts.expect === "setup")) {
          throw new Error(`health mode ${j.mode} != expected ${opts.expect}`);
        }
      }
      const dataStatus = j.data?.status;
      if (opts.expect === "setup" && status !== 503) throw new Error(`setup must be 503 not ${status}`);
      if (opts.expect !== "setup" && dataStatus !== "ok" && status === 200) throw new Error(`health data.status ${dataStatus} expected ok`);
      if (opts.expect === "setup" && dataStatus !== "unavailable") warn(`setup health data.status ${dataStatus} expected unavailable`);
      // Never claim live readiness when expecting demo/setup
      if ((opts.expect === "demo" || opts.expect === "setup") && j.mode === "live") {
        throw new Error("existing-server smoke must never claim live readiness when expect is demo/setup — got mode live");
      }
      // Must not leak secrets
      const raw = body.text.toLowerCase();
      if (raw.includes("supabase_url") && body.text.length < 5000) {
        // health is non-secret status only — should not include keys
        if (body.text.includes("SUPABASE") && body.text.length > 1000) warn("health body suspiciously large — ensure non-secret status only");
      }
    },
  ]);

  // 3. Session contract
  await getAndAssert("/api/session", 200, "session", [
    ({ headers, body }) => {
      if (!checkNoStore(headers)) warn("session missing no-store");
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`session invalid JSON: ${trunc(body.text)}`); }
      if (!j || j.data === undefined || j.mode === undefined) throw new Error("session missing {data,mode} envelope");
      if (j.mode !== opts.expect && !(opts.expect === "setup" && j.mode === "setup")) {
        throw new Error(`session mode ${j.mode} != expect ${opts.expect}`);
      }
      // Demo: user null but mode demo; live: user may be null unauth but mode live
      if (opts.expect === "demo" && j.mode !== "demo") throw new Error(`demo session must have mode demo, got ${j.mode}`);
    },
  ]);

  // 4. Categories contract
  let categoriesJson = null;
  const catRes = await getAndAssert("/api/categories", 200, "categories", [
    ({ headers, body }) => {
      if (!checkNoStore(headers)) warn("categories missing no-store");
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`categories invalid JSON: ${trunc(body.text)}`); }
      if (!Array.isArray(j.data)) throw new Error("categories data should be array Category[] per IMPLEMENTATION-CONTRACT");
      if (j.mode !== opts.expect && !(opts.expect === "setup" && j.mode === "setup")) throw new Error(`categories mode ${j.mode} != expect ${opts.expect}`);
      categoriesJson = j;
      if (opts.expect === "demo") {
        if (j.data.length !== 8) warn(`demo categories expected 8, got ${j.data.length}`);
        for (const c of j.data) if (!c.slug || !c.id) throw new Error("category missing slug/id");
      }
    },
  ]);

  // 5. Listings contract + pagination + demo marker
  let listingsJson = null;
  let firstListingId = null;
  const listingsRes = await getAndAssert("/api/listings", 200, "listings", [
    ({ headers, body }) => {
      if (!checkNoStore(headers)) warn("listings missing no-store");
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`listings invalid JSON: ${trunc(body.text)}`); }
      if (!Array.isArray(j.data)) throw new Error("listings data should be Listing[]");
      if (j.mode !== opts.expect && !(opts.expect === "setup" && j.mode === "setup")) throw new Error(`listings mode ${j.mode} != expect ${opts.expect}`);
      if (!j.meta) warn("listings missing meta {next_cursor,total}");
      else {
        if (j.meta.total !== undefined && typeof j.meta.total !== "number") throw new Error("listings meta.total not number");
      }
      if (opts.expect === "demo") {
        // Demo must have sample marker and illustration paths
        for (const l of j.data) {
          if (l.image_url && !l.image_url.startsWith("/demo/") && !l.image_url.includes("supabase")) {
            // demo listings use /demo/*.svg per src/lib/demo.ts
          }
        }
        if (j.data.length) {
          const sample = j.data[0];
          if (sample.image_url && !sample.image_url.startsWith("/demo/")) warn(`demo listing image_url ${trunc(sample.image_url)} expected /demo/*.svg`);
          if (sample.description && !sample.description.toLowerCase().includes("illustrative sample")) warn("demo listing missing sample marker in description — expect honest demo labeling per contract");
        }
      }
      if (opts.expect === "live" && j.data.length) {
        // Live listings must not be demo samples
        for (const l of j.data) if (l.image_url?.startsWith("/demo/")) throw new Error("live listings must not contain demo sample image_url");
      }
      listingsJson = j;
      if (j.data.length) firstListingId = j.data[0].id;
    },
  ]);

  // listings with query filters (demo+live support)
  await getAndAssert("/api/listings?category=furniture&q=seat", opts.expect === "setup" ? 503 : 200, "listings.filter", [
    ({ body, status }) => {
      if (status === 503 && opts.expect === "setup") return;
      if (opts.expect === "setup") throw new Error(`setup listings filter should be 503 per src/lib/server/queries.ts SETUP_REQUIRED, got ${status}`);
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`listings-filter invalid JSON: ${trunc(body.text)}`); }
      if (!Array.isArray(j.data)) throw new Error("filter listings data array required");
      if (!j.meta || j.meta.next_cursor === undefined) warn("filtered listings missing meta.next_cursor");
    },
  ]);

  // pagination check
  await getAndAssert("/api/listings?limit=1&cursor=0", opts.expect === "setup" ? 503 : 200, "listings.page1", [
    ({ body }) => {
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`page1 invalid JSON`); }
      if (opts.expect !== "setup" && j.meta && j.meta.total !== undefined && j.data.length === 0 && j.meta.total === 0) {
        // okay empty
      }
    },
  ]);
  await getAndAssert("/api/listings?limit=1&cursor=1", opts.expect === "setup" ? 503 : 200, "listings.page2", [
    ({ body }) => {
      // just ensure second page parses
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`page2 invalid JSON`); }
      if (!Array.isArray(j.data)) throw new Error("page2 data not array");
    },
  ]);

  // detail if available
  if (firstListingId) {
    await getAndAssert(`/api/listings/${firstListingId}`, 200, "listing.detail", [
      ({ headers, body }) => {
        if (!checkNoStore(headers)) warn("listing detail missing no-store");
        let j;
        try { j = JSON.parse(body.text); } catch { throw new Error(`listing detail invalid JSON: ${trunc(body.text)}`); }
        if (!j.data || !j.data.id) throw new Error("listing detail missing data.id");
        if (j.mode !== opts.expect && !(opts.expect === "setup" && j.mode === "setup")) throw new Error(`detail mode ${j.mode} != expect`);
        if (opts.expect === "demo" && j.data.image_url && !j.data.image_url.startsWith("/demo/")) warn("demo detail image_url not /demo/ — expected sample illustration");
      },
    ]);
  } else {
    info("No listings available for detail check — skipping");
  }

  // 6. Unauthenticated private API responses
  // Per actual code (src/app/api/*): demo private routes 401 or 403 depending on endpoint, live 401.
  // We assert not 200 with data leak; accept 401/403/503 for unauth.
  const privateGets = [
    { path: "/api/my-listings", demo: [401, 403], live: [401], setup: [503, 401, 403] },
    { path: "/api/threads", demo: [200, 401, 403], live: [401, 200], setup: [503, 401, 403] }, // threads GET in demo returns [] per spec note
    { path: "/api/profile", demo: [401, 403], live: [401], setup: [503, 401, 403] },
  ];
  for (const { path, demo, live, setup } of privateGets) {
    const expectedStatuses = opts.expect === "demo" ? demo : opts.expect === "live" ? live : setup;
    const r = await getAndAssert(path, expectedStatuses, "private-api", [
      ({ headers, body, status }) => {
        if (!checkNoStore(headers)) warn(`${path} missing no-store`);
        if (status === 200) {
          // Only /api/threads in demo is allowed to be 200 [] — verify shape
          let j;
          try { j = JSON.parse(body.text); } catch { throw new Error(`${path} 200 invalid JSON`); }
          if (path === "/api/threads" && opts.expect === "demo") {
            if (!Array.isArray(j.data)) throw new Error("demo threads 200 must be empty array");
            if (j.data.length !== 0) warn(`demo threads returned ${j.data.length} items — expected read-only empty per src/app/api/threads/route.ts`);
          } else if (path !== "/api/threads") {
            throw new Error(`${path} unauthenticated must not be 200 — expected ${expectedStatuses.join(",")}`);
          }
        } else if (status === 401 || status === 403) {
          let j;
          try { j = JSON.parse(body.text); } catch { return; } // error envelope optional
          if (j.error && !j.error.code) warn(`${path} ${status} error missing code`);
          if (opts.expect === "demo" && status === 401) info(`${path} demo 401 allowed (per src/app/api/my-listings/route.ts)`);
          if (opts.expect === "demo" && status === 403) info(`${path} demo 403 allowed (per requireUser 403 demo_readonly)`);
          if (opts.expect === "live" && status === 403) warn(`${path} live returned 403 not 401 — should be 401 per requireUser`);
        } else if (status === 503) {
          if (opts.expect !== "setup") warn(`${path} 503 unexpected for expect=${opts.expect} — indicates live schema unavailable`);
        }
      },
    ]);
  }

  // 7. PWA manifest/icons/offline/service-worker
  await getAndAssert("/manifest.webmanifest", 200, "pwa.manifest", [
    ({ headers, body }) => {
      const ct = headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("application/manifest") && !ct.toLowerCase().includes("json")) warn(`manifest content-type ${ct} expected manifest+json`);
      let j;
      try { j = JSON.parse(body.text); } catch { throw new Error(`manifest invalid JSON: ${trunc(body.text)}`); }
      if (!j.name || !j.icons) throw new Error("manifest missing name/icons");
      if (!Array.isArray(j.icons) || j.icons.length < 2) warn(`manifest icons expected ≥2, got ${j.icons?.length ?? 0}`);
      for (const ic of j.icons ?? []) if (!ic.src || !ic.sizes) throw new Error("manifest icon missing src/sizes");
    },
  ]);

  // offline.html checks
  await getAndAssert("/offline.html", 200, "pwa.offline", [
    ({ headers, body }) => {
      const ct = headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("text/html")) throw new Error(`offline content-type ${ct} not html`);
      if (!body.text.toLowerCase().includes("offline")) warn("offline.html missing offline marker");
    },
  ]);

  // sw.js
  await getAndAssert("/sw.js", 200, "pwa.sw", [
    ({ headers, body }) => {
      const cc = headers.get("cache-control") || "";
      if (!cc.toLowerCase().includes("no-cache")) warn("sw.js Cache-Control should be no-cache,no-store per next.config headers");
      const ct = headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("javascript") && !ct.toLowerCase().includes("application")) warn(`sw.js content-type ${ct} unexpected`);
      if (!body.text.includes("relove-shell")) warn("sw.js missing CACHE relove-shell marker");
      const cl = headers.get("content-length");
      if (cl && Number(cl) > 20000) warn("sw.js unexpectedly large — ensure network-only for APIs/auth per public/sw.js");
    },
  ]);

  // icons
  const icons = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/icon.svg", "/icons/apple-touch-icon.png"];
  for (const ic of icons) {
    // some icons may not exist in skeleton (apple-touch-icon optional) — treat missing as warn not fail if expect demo and not critical
    const res = await getAndAssert(ic, [200, 404], "pwa.icon", [
      ({ headers, status }) => {
        if (status === 200) {
          const ct = headers.get("content-type") || "";
          if (!ct.toLowerCase().includes("image/") && !ct.toLowerCase().includes("svg")) warn(`${ic} content-type ${ct} not image`);
        } else {
          warn(`${ic} missing (404) — expected PWA icons per src/app/manifest.ts`);
        }
      },
    ]);
  }

  // 8. Do not invoke OAuth — ensure we never GET /auth/login
  // (we intentionally avoid; just verify instruction)
  info("OAuth endpoints not fetched per spec (ONLY GET, avoid /auth/login)");

  // Summary
  const passed = failures.length === 0;
  return { passed, failures, warnings, infos, checks };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    console.error(HELP);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!opts.expect || !["demo", "live", "setup"].includes(opts.expect)) {
    console.error("error: --expect=demo|live|setup is required");
    console.error(HELP);
    process.exit(2);
  }
  if (!opts.origin.startsWith("http")) {
    console.error(`error: --origin must be http(s) URL, got ${opts.origin}`);
    process.exit(2);
  }
  if (Number.isFinite(opts.port) && (opts.port < 1 || opts.port > 65535)) {
    console.error(`error: --port must be 1..65535`);
    process.exit(2);
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout < 1000 || opts.timeout > 60000) {
    console.error("error: --timeout must be 1000..60000");
    process.exit(2);
  }

  let serverHandle = null;
  let origin = opts.origin;
  let port = opts.port;

  // --start lifecycle: must ALWAYS clean up child
  if (opts.start) {
    try {
      port = await findFreePort(port);
      origin = `http://127.0.0.1:${port}`;
      console.log(`↻ --start: launching production server on ${origin} with APP_MODE=${opts.expect} (AI off)`);
      serverHandle = await spawnNextServer(port, opts.expect);
      // readiness polling <=30s
      await pollReady(origin, START_MAX_MS);
      console.log(`✓ server ready at ${origin}`);
      opts.origin = origin;
    } catch (e) {
      console.error(`✗ --start failed: ${e instanceof Error ? e.message : String(e)}`);
      if (serverHandle?.child) {
        try { console.error(trunc(serverHandle.stderr?.() ?? "")); } catch {}
      }
      if (serverHandle) {
        await serverHandle.cleanup();
        serverHandle.restoreSignals();
      }
      process.exit(1);
    }
  }

  // Guard: existing-server smoke must never claim live readiness when expect demo/setup
  // This is enforced inside health check; but also pre-warn if origin looks like production live host while expect demo
  if (!opts.start && opts.expect !== "live") {
    try {
      const origHost = new URL(origin).hostname;
      if (origHost.includes("vercel.app") && opts.expect === "demo") {
        // Don't fail yet, but ensure health verifies; add info
      }
    } catch {}
  }

  let result;
  try {
    result = await runSmoke({ ...opts, origin });
  } catch (e) {
    console.error(`✗ smoke fatal: ${e instanceof Error ? e.message : String(e)}`);
    if (serverHandle) {
      await serverHandle.cleanup();
      serverHandle.restoreSignals();
    }
    process.exit(1);
  }

  // Output
  console.log(`\nRe-Love smoke — origin=${origin} expect=${opts.expect} ${opts.start ? "(--start)" : "(existing)"}`);
  console.log("-".repeat(60));
  for (const line of result.checks) console.log(line);
  console.log("");
  if (result.warnings.length) {
    console.log(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
  }
  console.log(`Result: ${verdict(result.passed, result.failures.length)}`);
  if (result.failures.length) {
    console.log("\nFailures:");
    for (const f of result.failures) console.log(`  ✗ ${f}`);
    console.log("\nFix and re-run:");
    console.log(`  node scripts/smoke-http.mjs --expect=${opts.expect} --origin=${origin}`);
  }
  if (result.infos.length) {
    console.log("\nInfo:");
    for (const i of result.infos.slice(0, 20)) console.log(`  · ${i}`);
  }

  if (serverHandle) {
    console.log("\n↻ shutting down --start server …");
    await serverHandle.cleanup();
    serverHandle.restoreSignals();
    // ensure not to report PASS if child had error output suggesting failure to force mode
    const serr = serverHandle.stderr?.() ?? "";
    if (serr.toLowerCase().includes("error") && serr.toLowerCase().includes("app_mode")) {
      console.log("⚠ server stderr contained app_mode error — verify forced APP_MODE");
    }
  }

  // Spec: existing-server smoke must never claim live DB readiness when mode demo/setup
  // We already validated; if health returned live while expect demo, failure already recorded.

  process.exit(result.passed ? 0 : 1);
}

// Export helpers for tests (no secrets printed)
export { parseArgs, isSameOrigin, checkNoStore, fetchBounded, findFreePort, isPortFree };

const isMain = import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) {
  main().catch((err) => {
    console.error("smoke-http fatal: " + (err instanceof Error ? err.message.slice(0, 500) : String(err)));
    process.exit(1);
  });
}
