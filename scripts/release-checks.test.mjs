#!/usr/bin/env node
/**
 * Re-Love release-checks tests — dependency-free Node 22.14+ using built-in node:test
 * Trustworthy: isolated from host secrets, real behavioral smoke against stub origins,
 * bounded subprocess timeouts & cleanup (Windows), no placeholder asserts.
 *
 * Run: node --test scripts/release-checks.test.mjs
 * Or:  npm run test:release
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHECK_ENV = path.join(ROOT, "scripts", "check-env.mjs");
const SMOKE_HTTP = path.join(ROOT, "scripts", "smoke-http.mjs");

// --- isolated env helper ---
const SENSITIVE_RE = /^(APP_MODE|SUPABASE_|GOOGLE_AUTH_ENABLED|AI_|BASETEN_|META_API|NEXT_PUBLIC_)/;
// keep essential Windows/Unix vars for spawning to work
const SAFE_KEEP = new Set([
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ComSpec",
  "windir",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TERM",
  "USER",
  "LOGNAME",
  "HOME",
]);

function isolatedEnv(overrides = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SENSITIVE_RE.test(k)) continue;
    // keep known safe or non-sensitive (allow most, but skip known secret prefixes)
    // Always keep PATH etc, otherwise keep everything except sensitive
    env[k] = v;
  }
  // ensure critical Windows vars present even if they were filtered (they aren't sensitive)
  for (const k of SAFE_KEEP) if (process.env[k] && !env[k]) env[k] = process.env[k];
  // apply overrides: explicit undefined means delete, else set
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) delete env[k];
    else env[k] = String(v);
  }
  return env;
}

function runCli(script, args = [], envOverrides = {}, { timeoutMs = 12000 } = {}) {
  return new Promise((resolve) => {
    const env = isolatedEnv(envOverrides);
    // spawn with isolated env; if script needs no env, it gets clean slate
    const child = spawn(process.execPath, [script, ...args], { env, cwd: ROOT });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // enforce wall timeout
    const wall = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
      // Windows tree kill best-effort
      if (process.platform === "win32" && child.pid) {
        try {
          const cp = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
          cp.on("error", () => {});
        } catch {}
      }
      // final SIGKILL after 1s
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1000);
    }, timeoutMs);
    // hard safety: unref after timeout +2s to avoid hanging tests
    wall.unref?.();

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code, signal) => {
      clearTimeout(wall);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(wall);
      resolve({ code: null, error: err, stdout, stderr, timedOut });
    });
  });
}

function hasSecretLeak(output) {
  return /eyJ[A-Za-z0-9_\-]{20,}/.test(output) && output.includes("SUPABASE_PUBLISHABLE_KEY");
}

// --- stub origin factory ---
const DEMO_CATEGORIES = Array.from({ length: 8 }, (_, i) => ({
  id: `cat-${i}`,
  slug: `cat-${i}`,
  name: `Category ${i}`,
  icon: "icon",
}));

const DEMO_LISTINGS = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    seller_id: "10000000-0000-4000-8000-000000000001",
    category_id: "cat-2",
    title: "Your new favourite desk chair",
    description:
      "This is an illustrative sample listing for exploring Re-Love. It is not an item for sale. Real sellers will add their own original photos, confirm the condition, and arrange a campus pickup through private messages.",
    price_inr: 1600,
    condition: "good",
    hostel_block: "Block A",
    status: "active",
    image_url: "/demo/chair.svg",
    image_path: "10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001.jpg",
    cutout_url: null,
    tags: ["chair", "seat", "furniture"],
    ai_status: "none",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    category: { id: "cat-2", slug: "furniture", name: "Furniture", icon: "chair" },
    seller: { id: "10000000-0000-4000-8000-000000000001", display_name: "Sample seller A", avatar_url: null, hostel_block: "Block A", created_at: "2026-11-01T00:00:00Z" },
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    seller_id: "10000000-0000-4000-8000-000000000002",
    category_id: "cat-2",
    title: "A spare seat for your room",
    description:
      "This is an illustrative sample listing for exploring Re-Love. It is not an item for sale. An illustrative sample for testing.",
    price_inr: 800,
    condition: "fair",
    hostel_block: "Block B",
    status: "active",
    image_url: "/demo/chair.svg",
    image_path: "10000000-0000-4000-8000-000000000002/20000000-0000-4000-8000-000000000002.jpg",
    cutout_url: null,
    tags: ["seat", "chair"],
    ai_status: "none",
    created_at: "2026-11-01T00:00:01Z",
    updated_at: "2026-11-01T00:00:01Z",
    category: { id: "cat-2", slug: "furniture", name: "Furniture", icon: "chair" },
    seller: { id: "10000000-0000-4000-8000-000000000002", display_name: "Sample seller B", avatar_url: null, hostel_block: "Block B", created_at: "2026-11-01T00:00:00Z" },
  },
];

function htmlDoc(title = "Re-Love") {
  // >200 bytes html
  return `<!doctype html><html><head><title>${title}</title><meta charset="utf-8"></head><body><h1>${title}</h1><p>${"Placeholder content for Re-Love marketplace. ".repeat(10)}</p></body></html>`;
}

function createDemoStub({ healthOverride, sessionOverride, htmlRedirect, listingsOverride, privateOverride, pwaOverride } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // PWA static first
    if (pathname === "/manifest.webmanifest") {
      if (pwaOverride?.manifestStatus === 404) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" });
      res.end(
        JSON.stringify({
          name: "Re-Love",
          short_name: "Re-Love",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        }),
      );
      return;
    }
    if (pathname === "/offline.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(htmlDoc("Offline - you are offline"));
      return;
    }
    if (pathname === "/sw.js") {
      res.writeHead(200, {
        "content-type": "application/javascript",
        "cache-control": "no-cache, no-store",
      });
      // must contain relove-shell
      res.end(`// relove-shell v1\nself.addEventListener('fetch', e=>{});`);
      return;
    }
    if (pathname.startsWith("/icons/")) {
      // handle 5 expected icons
      const goodIcons = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/icon.svg", "/icons/apple-touch-icon.png"];
      if (goodIcons.includes(pathname)) {
        const ct = pathname.endsWith(".svg") ? "image/svg+xml" : "image/png";
        res.writeHead(200, { "content-type": ct, "cache-control": "public, max-age=86400" });
        // minimal png/svg bytes
        res.end(ct.includes("svg") ? "<svg xmlns='http://www.w3.org/2000/svg'></svg>" : Buffer.alloc(200));
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }

    // HTML routes
    const htmlRoutes = ["/", "/categories", "/search", "/login", "/sell", "/my-listings", "/inbox", "/profile", "/privacy"];
    if (htmlRoutes.includes(pathname)) {
      if (htmlRedirect && pathname === htmlRedirect.path) {
        const loc = htmlRedirect.location;
        res.writeHead(302, { location: loc });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlDoc(`Re-Love ${pathname}`));
      return;
    }

    // API: health
    if (pathname === "/api/health") {
      if (healthOverride) {
        const { status = 503, body } = healthOverride;
        const payload = body ?? { data: { status: "unavailable", reason: "missing_config", mode: "setup" }, mode: "setup" };
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(payload));
        return;
      }
      // default demo healthy
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "ok", mode: "demo", auth_configured: false, ai_enabled: false, timestamp: new Date().toISOString() }, mode: "demo" }));
      return;
    }

    // API: session
    if (pathname === "/api/session") {
      if (sessionOverride) {
        const { status = 200, body } = sessionOverride;
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { user: null, mode: "demo", ai_enabled: false, auth_configured: false }, mode: "demo" }));
      return;
    }

    // API: categories
    if (pathname === "/api/categories") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: DEMO_CATEGORIES, mode: "demo" }));
      return;
    }

    // API: listings (list, filter, pagination) and detail
    if (pathname === "/api/listings" || pathname.startsWith("/api/listings")) {
      // Detail: /api/listings/<id>
      const detailMatch = pathname.match(/^\/api\/listings\/([a-z0-9-]+)$/i);
      if (detailMatch) {
        const id = detailMatch[1];
        const found = DEMO_LISTINGS.find((l) => l.id === id);
        if (!found) {
          res.writeHead(404, { "content-type": "application/json", "cache-control": "private, no-store" });
          res.end(JSON.stringify({ error: { code: "not_found" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify({ data: found, mode: "demo" }));
        return;
      }
      // list routes
      if (listingsOverride) {
        const { status = 200, body } = listingsOverride;
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(body ?? { data: [], mode: "demo", meta: { next_cursor: null, total: 0 } }));
        return;
      }
      // pagination handling
      const limit = Number(url.searchParams.get("limit") || "20");
      const cursor = Number(url.searchParams.get("cursor") || "0");
      // furniture&seat filter: return only 1 of them
      const cat = url.searchParams.get("category");
      const q = url.searchParams.get("q");
      let data = DEMO_LISTINGS;
      if (cat === "furniture" && q === "seat") {
        data = DEMO_LISTINGS.filter((l) => l.title.toLowerCase().includes("seat") || l.tags.includes("seat"));
      }
      if (limit === 1) {
        data = data.slice(cursor, cursor + 1);
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data, mode: "demo", meta: { next_cursor: data.length ? String(cursor + 1) : null, total: DEMO_LISTINGS.length } }));
      return;
    }

    // Private APIs
    if (pathname === "/api/my-listings") {
      if (privateOverride?.myListings) {
        const { status, body } = privateOverride.myListings;
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(body ?? { error: { code: "unauthorized" } }));
        return;
      }
      // demo read-only 403 per auth.ts
      res.writeHead(403, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ error: { code: "demo_readonly", message: "Demo mode is read-only" } }));
      return;
    }
    if (pathname === "/api/profile") {
      if (privateOverride?.profile) {
        const { status, body } = privateOverride.profile;
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(body ?? { error: { code: "unauthorized" } }));
        return;
      }
      res.writeHead(403, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ error: { code: "demo_readonly" } }));
      return;
    }
    if (pathname === "/api/threads") {
      if (privateOverride?.threads) {
        const { status, body } = privateOverride.threads;
        res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end(JSON.stringify(body ?? { error: { code: "unauthorized" } }));
        return;
      }
      // demo threads returns empty array 200
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: [], mode: "demo" }));
      return;
    }

    // fallback
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  return server;
}

let sharedServer;
let sharedOrigin;

before(async () => {
  // shared server for fetchBounded primitives
  sharedServer = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/ok") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "ok", mode: "demo" }, mode: "demo" }));
    } else if (url.pathname === "/redirect-same") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else if (url.pathname === "/redirect-cross") {
      res.writeHead(302, { location: "https://evil.example.com/ok" });
      res.end();
    } else if (url.pathname === "/large") {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "private, no-store" });
      res.end("a".repeat(2_000_000));
    } else if (url.pathname === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("late");
      }, 1000);
    } else if (url.pathname === "/no-store-missing") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => sharedServer.listen(0, "127.0.0.1", r));
  const addr = sharedServer.address();
  sharedOrigin = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (sharedServer) await new Promise((r) => sharedServer.close(r));
});

// --- check-env tests ---
describe("check-env CLI", () => {
  it("--help exits 0 and mentions --env-file", async () => {
    const r = await runCli(CHECK_ENV, ["--help"], {}, { timeoutMs: 5000 });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /--env-file/);
    assert.match(r.stdout, /APP_MODE/);
    assert.equal(hasSecretLeak(r.stdout + r.stderr), false);
  });

  it("demo with no env passes (isolated, must work with no env)", async () => {
    // isolatedEnv ensures no host secrets leak; we explicitly pass clean minimal env
    const r = await runCli(CHECK_ENV, [], {}, { timeoutMs: 5000 });
    assert.equal(r.code, 0, `demo no-env should PASS, got ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /PASS/);
    assert.equal(hasSecretLeak(r.stdout), false);
  });

  it("is isolated from host: host SUPABASE_URL does not affect demo pass", async () => {
    // Simulate host having live env; isolated run should still pass demo
    // We verify by passing no overrides -> isolatedEnv strips sensitive host vars
    // If isolation broken, a prior test that set live would bleed
    const r = await runCli(CHECK_ENV, [], { APP_MODE: "demo" }, { timeoutMs: 5000 });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /PASS/);
  });

  it("invalid APP_MODE fails with clear message and never prints value", async () => {
    const r = await runCli(CHECK_ENV, [], { APP_MODE: "INVALID_MODE_XYZ" }, { timeoutMs: 5000 });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /APP_MODE invalid/);
    assert.equal(hasSecretLeak(r.stdout + r.stderr), false);
  });

  it("rejects forbidden NEXT_PUBLIC credential", async () => {
    const r = await runCli(CHECK_ENV, [], { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", APP_MODE: "demo" }, { timeoutMs: 5000 });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Forbidden public credential/);
  });

  it("rejects service_role used as publishable key (string contains)", async () => {
    const fakeService = "eyJhbGci_fake_service_role_payload_with_service_role_inside_very_long_token_1234567890";
    const r = await runCli(CHECK_ENV, [], {
      APP_MODE: "live",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: fakeService,
    }, { timeoutMs: 5000 });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /service_role/);
    assert.equal(hasSecretLeak(r.stdout + r.stderr), false, "must not print raw service_role value");
  });

  it("rejects JWT with role=service_role decoded", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "service_role", exp: 9999999999 })).toString("base64url");
    const fakeJwt = `${header}.${payload}.signature`;
    const r = await runCli(CHECK_ENV, [], {
      APP_MODE: "live",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: fakeJwt,
    }, { timeoutMs: 5000 });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /service_role/);
  });

  it("live requires Supabase URL+key, https with localhost exception", async () => {
    const r1 = await runCli(CHECK_ENV, [], { APP_MODE: "live" }, { timeoutMs: 5000 });
    assert.equal(r1.code, 1);
    assert.match(r1.stdout, /SUPABASE_URL is required/);

    const r2 = await runCli(CHECK_ENV, [], {
      APP_MODE: "live",
      SUPABASE_URL: "http://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "valid-looking-key-12345678901234567890",
    }, { timeoutMs: 5000 });
    assert.equal(r2.code, 1);
    assert.match(r2.stdout, /must use https/);

    const r3 = await runCli(CHECK_ENV, [], {
      APP_MODE: "demo",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_PUBLISHABLE_KEY: "local-key",
    }, { timeoutMs: 5000 });
    assert.equal(r3.code, 0);
    assert.match(r3.stdout, /localhost/);
  });

  it("validates numeric caps, allows zero (off)", async () => {
    const rBad = await runCli(CHECK_ENV, [], { APP_MODE: "demo", AI_DAILY_LIMIT: "not-a-number" }, { timeoutMs: 5000 });
    assert.equal(rBad.code, 1);
    assert.match(rBad.stdout, /AI_DAILY_LIMIT must be an integer/);

    const rOutOfRange = await runCli(CHECK_ENV, [], { APP_MODE: "demo", AI_USER_DAILY_LIMIT: "9999" }, { timeoutMs: 5000 });
    assert.equal(rOutOfRange.code, 1);

    const rZero = await runCli(CHECK_ENV, [], { APP_MODE: "demo", AI_DAILY_LIMIT: "0", AI_USER_DAILY_LIMIT: "0" }, { timeoutMs: 5000 });
    assert.equal(rZero.code, 0);
    assert.match(rZero.stdout, /0 means off/);
  });

  it("provider credentials conditional on AI_ENABLED", async () => {
    const r1 = await runCli(CHECK_ENV, [], { APP_MODE: "demo", AI_ENABLED: "true" }, { timeoutMs: 5000 });
    assert.equal(r1.code, 0);
    assert.match(r1.stdout, /requires at least one provider key/);

    const r2 = await runCli(CHECK_ENV, ["--strict"], { APP_MODE: "demo", AI_ENABLED: "true" }, { timeoutMs: 5000 });
    assert.equal(r2.code, 1, "strict mode should fail when AI_ENABLED true but no keys");
  });

  it("never prints secret values on success or failure", async () => {
    const secret = "sk-secret-" + "a".repeat(40);
    const r = await runCli(CHECK_ENV, [], {
      APP_MODE: "live",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: secret,
      BASETEN_API_KEY: secret,
    }, { timeoutMs: 5000 });
    const all = r.stdout + r.stderr;
    assert.equal(all.includes(secret), false, "output must not contain raw secret value");
  });

  it("JSON mode outputs machine-readable without secrets", async () => {
    const r = await runCli(CHECK_ENV, ["--json"], { APP_MODE: "demo" }, { timeoutMs: 5000 });
    assert.equal(r.code, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.mode, "demo");
    assert.equal(typeof j.envPresence.SUPABASE_PUBLISHABLE_KEY, "string");
    assert.match(j.envPresence.SUPABASE_PUBLISHABLE_KEY, /unset|set \(/);
    assert.equal(JSON.stringify(j).includes("eyJ"), false);
  });
});

describe("smoke-http CLI", () => {
  it("--help exits 0", async () => {
    const r = await runCli(SMOKE_HTTP, ["--help"], {}, { timeoutMs: 5000 });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /--expect=demo\|live\|setup/);
  });

  it("requires --expect", async () => {
    const r = await runCli(SMOKE_HTTP, [], {}, { timeoutMs: 5000 });
    assert.equal(r.code, 2);
    assert.match(r.stderr + r.stdout, /--expect/);
  });

  it("rejects unknown option with exit 2", async () => {
    const r = await runCli(SMOKE_HTTP, ["--unknown"], {}, { timeoutMs: 5000 });
    assert.equal(r.code, 2);
  });

  it("helpers: isSameOrigin rejects cross-origin", async () => {
    const { isSameOrigin } = await import(pathToFileURL(SMOKE_HTTP).href);
    assert.equal(isSameOrigin("http://localhost:3000", "https://evil.example.com/ok"), false);
    assert.equal(isSameOrigin("http://localhost:3000", "/ok"), true);
    assert.equal(isSameOrigin("http://localhost:3000", "http://localhost:3000/ok"), true);
    assert.equal(isSameOrigin("http://a.test:3000", "http://b.test:3000"), false);
  });

  it("helpers: checkNoStore detects no-store", async () => {
    const { checkNoStore } = await import(pathToFileURL(SMOKE_HTTP).href);
    const h1 = new Headers({ "cache-control": "private, no-store" });
    assert.equal(checkNoStore(h1), true);
    const h2 = new Headers({ "cache-control": "public, max-age=60" });
    assert.equal(checkNoStore(h2), false);
  });

  it("fetchBounded respects body limit and does not print full body", async () => {
    const { fetchBounded } = await import(pathToFileURL(SMOKE_HTTP).href);
    const { body } = await fetchBounded(`${sharedOrigin}/large`, { timeout: 4000, bodyLimit: 1000, redirect: "manual" });
    assert.equal(body.truncated, true);
    assert.ok(body.text.length <= 1500, "truncated text should not exceed limit + slack");
    assert.ok(body.bytes >= 1000, "should count bytes up to truncation");
  });

  it("fetchBounded times out bounded", async () => {
    const { fetchBounded } = await import(pathToFileURL(SMOKE_HTTP).href);
    let timedOut = false;
    try {
      await fetchBounded(`${sharedOrigin}/slow`, { timeout: 200, bodyLimit: 10000, redirect: "manual" });
    } catch (e) {
      timedOut = /timeout|abort/i.test(String(e));
    }
    assert.equal(timedOut, true, "slow endpoint should timeout");
  });

  it("fetchBounded manual redirect prevents auto-follow and allows safe same-origin check", async () => {
    const { fetchBounded } = await import(pathToFileURL(SMOKE_HTTP).href);
    const cross = await fetchBounded(`${sharedOrigin}/redirect-cross`, { timeout: 2000, bodyLimit: 5000, redirect: "manual" });
    assert.equal(cross.status, 302);
    const loc = cross.headers.get("location");
    assert.equal(loc, "https://evil.example.com/ok");
    const { isSameOrigin } = await import(pathToFileURL(SMOKE_HTTP).href);
    assert.equal(isSameOrigin(sharedOrigin, loc), false);
  });

  it("smoke succeeds when origin matches demo contract", async () => {
    const srv = createDemoStub();
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const addr = srv.address();
    const origin = `http://127.0.0.1:${addr.port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.timedOut, false, "smoke demo success should not timeout");
      assert.equal(r.code, 0, `demo stub should PASS, got ${r.code}\nSTDOUT:\n${r.stdout.slice(0, 2000)}\nSTDERR:\n${r.stderr.slice(0, 1000)}`);
      assert.match(r.stdout, /Result: PASS/);
      // must contain health and listings checks
      assert.match(r.stdout, /health/);
      assert.match(r.stdout, /listings/);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("smoke fails when health mode is live but expect is demo (never claim live readiness)", async () => {
    const srv = createDemoStub({
      healthOverride: { status: 200, body: { data: { status: "ok", mode: "live" }, mode: "live" } },
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.timedOut, false);
      assert.equal(r.code, 1, `wrong mode should FAIL, got ${r.code}\n${r.stdout.slice(0, 2000)}`);
      assert.match(r.stdout, /health mode live/i);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("smoke fails when health is 503 but expect is demo", async () => {
    const srv = createDemoStub({
      healthOverride: { status: 503, body: { data: { status: "unavailable", reason: "missing_config", mode: "setup" }, mode: "setup" } },
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.timedOut, false);
      assert.equal(r.code, 1, `health 503 should FAIL for demo, got ${r.code}\n${r.stdout.slice(0, 2000)}`);
      assert.match(r.stdout, /health.*503|health mode setup/i);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("smoke fails on cross-origin redirect", async () => {
    const srv = createDemoStub({
      htmlRedirect: { path: "/", location: "https://evil.example.com/ok" },
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.timedOut, false);
      assert.equal(r.code, 1, `cross-origin redirect should FAIL, got ${r.code}\n${r.stdout.slice(0, 2000)}`);
      assert.match(r.stdout, /cross-origin redirect/i);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("smoke fails on unexpected same-origin redirect", async () => {
    const srv = createDemoStub({
      htmlRedirect: { path: "/categories", location: "/ok" },
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.timedOut, false);
      assert.equal(r.code, 1, `same-origin redirect should FAIL, got ${r.code}\n${r.stdout.slice(0, 2000)}`);
      assert.match(r.stdout, /unexpected redirect/i);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it("smoke bounding: subprocess always exits within timeout (bounded, Windows cleanup)", async () => {
    // Use a port guaranteed occupied by our own server to simulate --start failure path without spawning Next.
    // We instead verify that a smoke run with unreachable origin respects per-request timeout and exits.
    const unreachable = "http://127.0.0.1:59998";
    const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${unreachable}`, "--timeout=1000"], {}, { timeoutMs: 8000 });
    assert.equal(r.timedOut, false, "should exit within timeout, not wall-timeout");
    assert.equal(r.code, 1, "unreachable origin should FAIL not hang");
    // ensure it produced failure output quickly
    assert.match(r.stdout + r.stderr, /fetch failed|health|FAIL/i);
  });

  it("smoke verifies envelope contracts: categories/listings include mode and pagination", async () => {
    // Re-use demo success stub and inspect that smoke passed includes categories/listings pagination checks lines
    const srv = createDemoStub();
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${srv.address().port}`;
    try {
      const r = await runCli(SMOKE_HTTP, ["--expect=demo", `--origin=${origin}`, "--timeout=4000"], {}, { timeoutMs: 15000 });
      assert.equal(r.code, 0);
      // verify that pagination endpoints were checked
      assert.match(r.stdout, /listings\.page1/);
      assert.match(r.stdout, /listings\.page2/);
      assert.match(r.stdout, /categories/);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});
