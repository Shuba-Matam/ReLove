#!/usr/bin/env node
/**
 * Re-Love availability checker tests — dependency-free Node 22 ESM via node:test
 * Covers exported checker directly + local HTTP stubs, no external network.
 * Run: node --test scripts/check-availability.test.mjs
 * Or via: npm run test:release (imports this file)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  CANONICAL_ORIGIN,
  CUTOFF_ISO,
  CUTOFF_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BODY_LIMIT_BYTES,
  isExpired,
  validateOrigin,
  parseArgs,
  checkAvailability,
} from "./check-availability.mjs";

// Helper to create a stub health server with custom behavior per test
function makeHealthServer(handler) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/health") {
      handler(req, res, url);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain", "cache-control": "private, no-store" });
    res.end("not found");
  });
  return server;
}

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const origin = `http://127.0.0.1:${addr.port}`;
  return origin;
}

async function close(server) {
  await new Promise((r) => server.close(r));
}

function livePayload(overrides = {}) {
  return {
    data: { status: "ok", mode: "live", auth_configured: true, ai_enabled: false, timestamp: new Date().toISOString(), ...overrides.data },
    mode: "live",
    ...overrides.envelope,
  };
}

// Track fetch call count for zero-requests test
function countingFetch(fetchImpl) {
  let count = 0;
  const wrapped = async (...args) => {
    count++;
    return fetchImpl(...args);
  };
  wrapped.getCount = () => count;
  return wrapped;
}

describe("check-availability unit: constants & helpers", () => {
  it("exports canonical origin and cutoff", () => {
    assert.equal(CANONICAL_ORIGIN, "https://re-love-pi.vercel.app");
    assert.equal(CUTOFF_ISO, "2026-11-17T00:00:00.000Z");
    assert.equal(CUTOFF_MS, Date.parse("2026-11-17T00:00:00.000Z"));
    assert.ok(DEFAULT_TIMEOUT_MS >= 1000 && DEFAULT_TIMEOUT_MS <= 30000);
    assert.ok(DEFAULT_BODY_LIMIT_BYTES >= 1024);
  });

  it("isExpired boundary: before cutoff false, at cutoff true, after true", () => {
    const before = Date.parse("2026-11-16T23:59:59.999Z");
    const at = Date.parse("2026-11-17T00:00:00.000Z");
    const after = Date.parse("2026-11-17T00:00:01.000Z");
    assert.equal(isExpired(before), false);
    assert.equal(isExpired(at), true);
    assert.equal(isExpired(after), true);
    // with custom cutoff injection
    const customCutoff = Date.parse("2025-01-01T00:00:00Z");
    assert.equal(isExpired(Date.parse("2024-12-31T23:59:59Z"), customCutoff), false);
    assert.equal(isExpired(Date.parse("2025-01-01T00:00:00Z"), customCutoff), true);
  });

  it("validateOrigin: accepts HTTPS production", () => {
    const u = validateOrigin("https://re-love-pi.vercel.app");
    assert.equal(u.origin, "https://re-love-pi.vercel.app");
    // trailing slash normalized to origin still valid
    const u2 = validateOrigin("https://re-love-pi.vercel.app/");
    assert.equal(u2.origin, "https://re-love-pi.vercel.app");
    // https with port
    const u3 = validateOrigin("https://example.com:8443");
    assert.equal(u3.hostname, "example.com");
  });

  it("validateOrigin: accepts HTTP loopback only", () => {
    for (const h of ["http://localhost:3000", "http://127.0.0.1:4000", "http://127.0.0.1", "http://localhost"]) {
      const u = validateOrigin(h);
      assert.ok(u.protocol === "http:");
    }
    // IPv6 loopback (Node preserves brackets)
    const v6 = validateOrigin("http://[::1]:3000");
    assert.ok(["::1", "[::1]"].includes(v6.hostname), `expected ::1 loopback got ${v6.hostname}`);
  });

  it("validateOrigin: rejects HTTP non-loopback", () => {
    assert.throws(() => validateOrigin("http://example.com"), /http only allowed for loopback/i);
    assert.throws(() => validateOrigin("http://re-love-pi.vercel.app"), /http only allowed for loopback/i);
    assert.throws(() => validateOrigin("http://192.168.1.1"), /http only allowed for loopback/i);
  });

  it("validateOrigin: rejects userinfo/path/query/hash", () => {
    assert.throws(() => validateOrigin("https://user:pass@re-love-pi.vercel.app"), /userinfo/i);
    assert.throws(() => validateOrigin("https://re-love-pi.vercel.app/api/health"), /path/i);
    assert.throws(() => validateOrigin("https://re-love-pi.vercel.app/path"), /path/i);
    assert.throws(() => validateOrigin("https://re-love-pi.vercel.app?x=1"), /query/i);
    assert.throws(() => validateOrigin("https://re-love-pi.vercel.app#hash"), /hash/i);
    assert.throws(() => validateOrigin("https://re-love-pi.vercel.app/?x=1"), /query/i);
  });

  it("validateOrigin: rejects invalid/protocol", () => {
    assert.throws(() => validateOrigin("not-a-url"), /valid URL/i);
    assert.throws(() => validateOrigin("ftp://example.com"), /https or http/i);
    assert.throws(() => validateOrigin(""), /non-empty/i);
    assert.throws(() => validateOrigin("   "), /non-empty/i);
  });

  it("parseArgs: defaults canonical, validates ranges", () => {
    const o = parseArgs([]);
    assert.equal(o.origin, CANONICAL_ORIGIN);
    assert.equal(o.cutoff, CUTOFF_ISO);
    assert.throws(() => parseArgs(["--unknown"]), /unknown option/i);
    assert.throws(() => parseArgs(["--timeout=100"]), /timeout must be/i);
    assert.throws(() => parseArgs(["--timeout=99999"]), /timeout must be/i);
    assert.throws(() => parseArgs(["--body-limit=10"]), /body-limit must be/i);
    assert.throws(() => parseArgs(["--cutoff=not-date"]), /cutoff must be valid/i);
    assert.throws(() => parseArgs(["--now=not-date"]), /now must be valid/i);
    const o2 = parseArgs(["--origin=http://127.0.0.1:3000", "--timeout=2000", "--body-limit=4096", "--cutoff=2026-11-17T00:00:00Z"]);
    assert.equal(o2.origin, "http://127.0.0.1:3000");
    assert.equal(o2.timeout, 2000);
    assert.equal(o2.bodyLimit, 4096);
  });
});

describe("check-availability integration: live healthy vs failures", () => {
  it("PASS on live healthy 200 + no-store + correct envelope", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, bodyLimit: 32768, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, true);
      assert.equal(r.reason, "healthy");
      assert.match(r.safeMessage, /PASS/i);
      assert.equal(r.skipped, undefined);
    } finally { await close(server); }
  });

  it("FAIL on demo refusal (envelope mode demo must not be healthy)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "ok", mode: "demo" }, mode: "demo" }));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.notEqual(r.reason, "healthy");
      assert.match(r.safeMessage, /FAIL/i);
      // ensure not marked as healthy
      assert.equal(r.skipped, undefined);
    } finally { await close(server); }
  });

  it("FAIL on setup 503 (must not be false healthy)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "unavailable", reason: "missing_config", mode: "setup" }, mode: "setup" }));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "status");
      assert.match(r.safeMessage, /FAIL/i);
    } finally { await close(server); }
  });

  it("FAIL on malformed body (invalid JSON)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end("not-json {{{");
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "malformed_json");
      assert.match(r.safeMessage, /malformed/i);
      // safe error must not contain raw body
      assert.equal(r.safeMessage.includes("not-json"), false);
    } finally { await close(server); }
  });

  it("FAIL on oversized body (bounded bytes)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      // Send > bodyLimit bytes
      const big = "a".repeat(10000);
      res.end(big);
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, bodyLimit: 1024, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "body_too_large");
      assert.match(r.safeMessage, /exceeds/i);
    } finally { await close(server); }
  });

  it("FAIL when no-store missing (defeat cached readiness)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=60" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_store_missing");
      assert.match(r.safeMessage, /no-store/i);
    } finally { await close(server); }
  });

  it("FAIL on redirect (no-follow, no retries)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(302, { location: "https://evil.example.com/api/health", "cache-control": "private, no-store" });
      res.end();
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "redirect");
      assert.match(r.safeMessage, /redirect/i);
    } finally { await close(server); }
  });

  it("FAIL on data.status != ok even with 200", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "unavailable", mode: "live" }, mode: "live" }));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "data_status");
    } finally { await close(server); }
  });

  it("FAIL on envelope mode mismatch (data.mode live but envelope demo)", async () => {
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify({ data: { status: "ok", mode: "live" }, mode: "demo" }));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "envelope_mode");
    } finally { await close(server); }
  });

  it("FAIL on invalid origin without network", async () => {
    let fetchCalled = false;
    const fakeFetch = async () => { fetchCalled = true; return {}; };
    const r = await checkAvailability({ origin: "https://evil.com/path", fetchImpl: fakeFetch, nowMs: Date.parse("2026-11-10T00:00:00Z") });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_origin");
    assert.equal(fetchCalled, false);
    // userinfo variant
    const r2 = await checkAvailability({ origin: "https://user:pass@re-love-pi.vercel.app", fetchImpl: fakeFetch, nowMs: Date.parse("2026-11-10T00:00:00Z") });
    assert.equal(r2.ok, false);
    assert.equal(fetchCalled, false);
  });

  it("FAIL on http non-loopback without network", async () => {
    let called = false;
    const fake = async () => { called = true; };
    const r = await checkAvailability({ origin: "http://example.com", fetchImpl: fake, nowMs: Date.parse("2026-11-10T00:00:00Z") });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_origin");
    assert.equal(called, false);
  });

  it("cutoff boundary: before cutoff makes request, at/after skips with zero requests", async () => {
    // Server that would be healthy if called
    const server = makeHealthServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      // before cutoff => ok true, network happens
      const beforeMs = Date.parse("2026-11-16T23:59:59.000Z");
      const rBefore = await checkAvailability({ origin, timeout: 3000, nowMs: beforeMs, cutoffMs: CUTOFF_MS });
      assert.equal(rBefore.ok, true);
      assert.equal(rBefore.skipped, undefined);

      // at cutoff => skip, zero network — use counting fetch
      const countingAt = countingFetch(fetch);
      const atMs = Date.parse("2026-11-17T00:00:00.000Z");
      const rAt = await checkAvailability({ origin, fetchImpl: countingAt, nowMs: atMs, cutoffMs: CUTOFF_MS });
      assert.equal(rAt.skipped, true);
      assert.equal(rAt.ok, false);
      assert.match(rAt.safeMessage, /SKIP/i);
      assert.equal(countingAt.getCount(), 0, "zero requests at cutoff");

      // after cutoff => also skip
      const countingAfter = countingFetch(fetch);
      const afterMs = Date.parse("2026-11-18T00:00:00.000Z");
      const rAfter = await checkAvailability({ origin, fetchImpl: countingAfter, nowMs: afterMs, cutoffMs: CUTOFF_MS });
      assert.equal(rAfter.skipped, true);
      assert.equal(countingAfter.getCount(), 0, "zero requests after cutoff");

      // custom cutoff injection also works
      const customCutoff = Date.parse("2026-11-10T00:00:00Z");
      const countingCustom = countingFetch(fetch);
      const rCustom = await checkAvailability({ origin, fetchImpl: countingCustom, nowMs: Date.parse("2026-11-10T00:00:01Z"), cutoffMs: customCutoff });
      assert.equal(rCustom.skipped, true);
      assert.equal(countingCustom.getCount(), 0);
    } finally { await close(server); }
  });

  it("explicit skip distinct from pass (SKIP message vs PASS)", async () => {
    let called = false;
    const fake = async () => { called = true; };
    const rPassFake = await checkAvailability({
      fetchImpl: async () => ({
        status: 200,
        headers: { get: (n) => n.toLowerCase() === "cache-control" ? "private, no-store" : null },
        body: {
          getReader: () => {
            const chunks = [new TextEncoder().encode(JSON.stringify(livePayload()))];
            let i = 0;
            return {
              read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
              cancel: async () => {},
            };
          },
        },
      }),
      origin: "https://re-love-pi.vercel.app",
      nowMs: Date.parse("2026-11-10T00:00:00Z"),
    });
    assert.equal(rPassFake.ok, true);
    assert.match(rPassFake.safeMessage, /PASS/);

    const rSkip = await checkAvailability({
      fetchImpl: fake,
      origin: "https://re-love-pi.vercel.app",
      nowMs: Date.parse("2026-11-17T00:00:00Z"),
    });
    assert.equal(rSkip.skipped, true);
    assert.match(rSkip.safeMessage, /SKIP/);
    assert.notEqual(rSkip.safeMessage, rPassFake.safeMessage);
    assert.equal(called, false, "skip must not call fetch");
  });

  it("timeout includes body consumption (stalled body aborts)", async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      // Write headers but stall body forever (never end)
      // Keep connection open
      res.write('{"data":{"status":"ok","mode":"live"},"mode":"live"'.slice(0, 10));
      // do not res.end()
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 400, bodyLimit: 32768, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      // should be timeout
      assert.ok(r.reason === "timeout" || r.reason === "body_error" || r.reason === "fetch_error" || r.reason === "malformed_json");
      // But ensure we got a timeout-like handling, not success
      assert.equal(r.skipped, undefined);
    } finally {
      await close(server);
    }
  });

  it("timeout on slow headers via AbortSignal", async () => {
    const server = createServer((req, res) => {
      // delay response > timeout
      setTimeout(() => {
        try {
          res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
          res.end(JSON.stringify(livePayload()));
        } catch {}
      }, 2000);
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 300, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "timeout");
      assert.match(r.safeMessage, /timeout/i);
    } finally { await close(server); }
  });

  it("no secret leakage: safeMessage never contains body/auth/cookies or arbitrary text", async () => {
    const secretBody = JSON.stringify({ data: { status: "ok", mode: "live", token: "eyJhbGci_secret_token_1234567890_long_value" }, mode: "live", extra: "SUPABASE_PUBLISHABLE_KEY=eyJxxx" });
    const server = makeHealthServer((req, res) => {
      // If checker mistakenly sends auth/cookies, we'd see it — but it must not
      assert.equal(req.headers.authorization, undefined, "checker must not send Authorization");
      assert.equal(req.headers.cookie, undefined, "checker must not send Cookie");
      assert.equal(req.headers["cache-control"], "no-store");
      assert.equal(req.method, "GET");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(secretBody);
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      // This payload is actually live healthy? It has correct envelope but extra secret fields — should still pass?
      // But we verify safeMessage doesn't leak body even on pass
      const combined = (r.safeMessage + JSON.stringify(r)).toLowerCase();
      assert.equal(combined.includes("eyjhbgci"), false, "safeMessage must not leak token");
      assert.equal(combined.includes("supabase_publishable_key"), false);
      // Now test failure case leaks: malformed should not dump body
      const server2 = makeHealthServer((_, res) => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
        res.end("MALICIOUS_BODY_WITH_SECRET_EYJABC123_MALICIOUS");
      });
      const origin2 = await listen(server2);
      try {
        const r2 = await checkAvailability({ origin: origin2, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
        assert.equal(r2.ok, false);
        assert.equal(r2.safeMessage.includes("MALICIOUS_BODY"), false);
        assert.equal(r2.safeMessage.includes("EYJABC"), false);
      } finally { await close(server2); }
    } finally { await close(server); }
  });

  it("uses only one request, no retries (counts 1)", async () => {
    let count = 0;
    const server = makeHealthServer((_, res) => {
      count++;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, true);
      assert.equal(count, 1, "must be exactly one request, no retries");
    } finally { await close(server); }
  });

  it("sends no-store to defeat cached readiness", async () => {
    let sawNoStore = false;
    const server = makeHealthServer((req, res) => {
      if ((req.headers["cache-control"] || "").toLowerCase().includes("no-store")) sawNoStore = true;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, true);
      assert.equal(sawNoStore, true, "must send Cache-Control: no-store");
    } finally { await close(server); }
  });

  it("no redirects followed — manual redirect detection", async () => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname === "/api/health") {
        res.writeHead(301, { location: `${`http://${req.headers.host}`}/api/health2` });
        res.end();
        return;
      }
      // second location would be healthy but must not be followed
      res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
      res.end(JSON.stringify(livePayload()));
    });
    const origin = await listen(server);
    try {
      const r = await checkAvailability({ origin, timeout: 3000, nowMs: Date.parse("2026-11-10T00:00:00Z") });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "redirect");
    } finally { await close(server); }
  });

  it("oversized/malformed via fake fetch injection without network", async () => {
    // fake fetch returning oversized
    const fakeOversized = async () => ({
      status: 200,
      headers: { get: (n) => n.toLowerCase() === "cache-control" ? "private, no-store" : null },
      body: {
        getReader: () => {
          const big = new TextEncoder().encode("a".repeat(5000));
          return {
            read: async () => ({ done: false, value: big }),
            cancel: async () => {},
          };
        },
      },
    });
    const rOver = await checkAvailability({ origin: "https://re-love-pi.vercel.app", fetchImpl: fakeOversized, bodyLimit: 1024, nowMs: Date.parse("2026-11-10T00:00:00Z") });
    assert.equal(rOver.ok, false);
    assert.equal(rOver.reason, "body_too_large");

    // malformed JSON via fake fetch
    const fakeMalformed = async () => ({
      status: 200,
      headers: { get: (n) => n.toLowerCase() === "cache-control" ? "private, no-store" : "json" === n ? "application/json" : null },
      // actually need cache-control no-store to pass that check, otherwise it fails earlier
      headers: { get: (k) => k.toLowerCase() === "cache-control" ? "private, no-store" : null },
      body: {
        getReader: () => {
          const chunk = new TextEncoder().encode("{{{not json");
          let done = false;
          return {
            read: async () => {
              if (!done) { done = true; return { done: false, value: chunk }; }
              return { done: true, value: undefined };
            },
            cancel: async () => {},
          };
        },
      },
    });
    const rMal = await checkAvailability({ origin: "https://re-love-pi.vercel.app", fetchImpl: fakeMalformed, nowMs: Date.parse("2026-11-10T00:00:00Z") });
    assert.equal(rMal.ok, false);
    assert.equal(rMal.reason, "malformed_json");
  });
});

describe("check-availability CLI help and json", () => {
  it("parseArgs help flag", () => {
    const o = parseArgs(["--help"]);
    assert.equal(o.help, true);
  });
});
