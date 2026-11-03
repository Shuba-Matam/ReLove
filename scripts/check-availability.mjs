#!/usr/bin/env node
/**
 * Re-Love availability checker — bounded read-only GET /api/health
 * Dependency-free Node 22.14+ ESM.
 *
 * Contract (from existing envelope):
 *   Success requires: HTTP 200 + Cache-Control contains no-store +
 *   envelope { data:{ status:'ok', mode:'live' }, mode:'live' }
 *   Demo / setup / 503 / malformed must FAIL (not false-healthy).
 *
 * Safety:
 *   - HTTPS production or HTTP loopback only (localhost/127.0.0.1/::1/0.0.0.0)
 *   - Rejects userinfo/path/query/hash in origin
 *   - No redirects (redirect:manual, single request, no retries)
 *   - AbortSignal timeout includes body consumption
 *   - Bounded body bytes
 *   - Safe errors: never outputs arbitrary response text / auth / cookies
 *   - Hard cutoff 2026-11-17T00:00:00Z inclusive — zero requests after expiry
 *
 * Usage:
 *   node scripts/check-availability.mjs [--origin=https://re-love-pi.vercel.app] [--timeout=5000] [--body-limit=32768] [--cutoff=2026-11-17T00:00:00Z] [--now=ISO] [--json] [--help]
 *   Workflow: node scripts/check-availability.mjs --cutoff=2026-11-17T00:00:00Z (canonical, default)
 *   Local override: node scripts/check-availability.mjs --origin=http://127.0.0.1:3000
 */

export const CANONICAL_ORIGIN = "https://re-love-pi.vercel.app";
export const CUTOFF_ISO = "2026-11-17T00:00:00.000Z";
export const CUTOFF_MS = Date.parse(CUTOFF_ISO);
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_BODY_LIMIT_BYTES = 32_768; // bounded, safe for /api/health JSON
export const HEALTH_PATH = "/api/health";

const HELP = `
check-availability — bounded readiness probe for Re-Love /api/health

Usage:
  node scripts/check-availability.mjs [options]
  node scripts/check-availability.mjs --origin=http://127.0.0.1:3000 --timeout=4000

Options:
  --origin=URL        Origin to probe (default ${CANONICAL_ORIGIN})
                      HTTPS any host, or HTTP only for loopback (localhost/127.0.0.1/::1/0.0.0.0)
                      Must be bare origin — rejects userinfo/path/query/hash
  --timeout=MS        Per-request timeout incl. body (default ${DEFAULT_TIMEOUT_MS}, 1000..30000)
  --body-limit=BYTES  Max bytes to read (default ${DEFAULT_BODY_LIMIT_BYTES}, 1024..1048576)
  --cutoff=ISO        Hard close of judging window (default ${CUTOFF_ISO})
  --now=ISO           Override current time for testing (default now)
  --json              Machine-readable output (no secrets/body)
  --help, -h          Show help

Behavior:
  • Single GET \${origin}/api/health, redirect:manual, no retries, Cache-Control:no-store
  • Validates: 200 + no-store + envelope mode:live + data.status:ok + data.mode:live
  • Demo/setup/503/malformed/missing-no-store/redirect/oversized/timeout all FAIL
  • Hard cutoff ${CUTOFF_ISO} — no network on or after cutoff, even manual run
  • Expiry returns SKIP (exit 0, distinct from PASS) — never counted as healthy
  • Safe errors: generic codes only, never prints response body/auth/cookies

Exit codes:
  0  PASS (healthy live) or SKIP (expired window)
  1  FAIL (unhealthy / unreachable / invalid)
  2  usage error
`.trim();

export function isLoopbackHostname(hostname) {
  // URL hostname for IPv6 is "[::1]" in Node, handle both forms; also strip brackets if present
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

export function isExpired(nowMs, cutoffMs = CUTOFF_MS) {
  return nowMs >= cutoffMs;
}

/**
 * Validate origin string is bare origin and allowed protocol/host.
 * Throws with safe message on invalid; returns URL instance on success.
 */
export function validateOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) {
    throw new Error("origin invalid: must be non-empty URL string");
  }
  const raw = origin.trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("origin invalid: must be valid URL");
  }
  // protocol check: https always, http only if loopback
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("origin invalid: must be https or http (http only for loopback)");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("origin invalid: http only allowed for loopback (localhost/127.0.0.1/::1)");
  }
  // reject userinfo
  if (url.username || url.password) {
    throw new Error("origin invalid: must not contain userinfo");
  }
  // reject path/query/hash beyond bare origin
  // URL always normalizes pathname to "/" if omitted — allow that, reject anything else
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("origin invalid: must not contain path (use bare origin)");
  }
  if (url.search) {
    throw new Error("origin invalid: must not contain query");
  }
  if (url.hash) {
    throw new Error("origin invalid: must not contain hash");
  }
  // Additionally, ensure raw doesn't contain hidden path after origin check via string diff
  // We already checked URL components; catch encoded tricks via explicit raw string check:
  // If raw has "/" beyond "://host:port" (allowing single trailing slash), reject.
  // We already handled pathname, search, hash, so this is covered.
  return url;
}

export function parseArgs(argv) {
  const opts = {
    origin: CANONICAL_ORIGIN,
    timeout: DEFAULT_TIMEOUT_MS,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    cutoff: CUTOFF_ISO,
    now: null,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--origin=")) opts.origin = arg.slice("--origin=".length);
    else if (arg.startsWith("--timeout=")) {
      const v = Number(arg.slice("--timeout=".length));
      if (!Number.isFinite(v)) throw new Error("invalid --timeout value");
      opts.timeout = v;
    } else if (arg.startsWith("--body-limit=")) {
      const v = Number(arg.slice("--body-limit=".length));
      if (!Number.isFinite(v)) throw new Error("invalid --body-limit value");
      opts.bodyLimit = v;
    } else if (arg.startsWith("--cutoff=")) opts.cutoff = arg.slice("--cutoff=".length);
    else if (arg.startsWith("--now=")) opts.now = arg.slice("--now=".length);
    else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else throw new Error(`unknown argument: ${arg}`);
  }
  // validate numeric ranges early with safe messages
  if (!Number.isInteger(opts.timeout) || opts.timeout < 1000 || opts.timeout > 30000) {
    throw new Error("--timeout must be integer 1000..30000 ms");
  }
  if (!Number.isInteger(opts.bodyLimit) || opts.bodyLimit < 1024 || opts.bodyLimit > 1_048_576) {
    throw new Error("--body-limit must be integer 1024..1048576 bytes");
  }
  if (opts.cutoff) {
    const c = Date.parse(opts.cutoff);
    if (!Number.isFinite(c)) throw new Error("--cutoff must be valid ISO-8601");
  }
  if (opts.now) {
    const n = Date.parse(opts.now);
    if (!Number.isFinite(n)) throw new Error("--now must be valid ISO-8601");
  }
  return opts;
}

async function readBodyLimited(res, limit, signal) {
  if (!res.body) return { text: "", bytes: 0, truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  let truncated = false;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("timeout");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        truncated = true;
        // do not accumulate beyond limit — bounded
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

/**
 * Core checker — single GET, no retries, manual redirects, bounded, safe.
 * @param {object} args
 * @param {string} args.origin - bare origin
 * @param {number} args.timeout - ms incl body
 * @param {number} args.bodyLimit - bytes
 * @param {function} [args.fetchImpl] - injectable fetch (default global fetch)
 * @param {number} [args.nowMs] - override now (default Date.now())
 * @param {number} [args.cutoffMs] - override cutoff
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason:string, safeMessage:string, details?:object}>}
 */
export async function checkAvailability({
  origin = CANONICAL_ORIGIN,
  timeout = DEFAULT_TIMEOUT_MS,
  bodyLimit = DEFAULT_BODY_LIMIT_BYTES,
  fetchImpl = fetch,
  nowMs = Date.now(),
  cutoffMs = CUTOFF_MS,
} = {}) {
  // CUT-1: hard window guard — must be first, unit testable, zero network after expiry
  if (isExpired(nowMs, cutoffMs)) {
    return {
      ok: false,
      skipped: true,
      reason: "expired",
      safeMessage: `SKIP: availability window closed at ${new Date(cutoffMs).toISOString()} — no request made`,
    };
  }

  // Origin validation (safe errors, no network on invalid)
  let url;
  try {
    url = validateOrigin(origin);
  } catch (e) {
    return {
      ok: false,
      reason: "invalid_origin",
      safeMessage: `FAIL: ${e instanceof Error ? e.message : "origin invalid"}`,
    };
  }

  const target = `${url.origin}${HEALTH_PATH}`;

  // Single GET, no redirects, bounded timeout includes body
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeout);
  // Ensure timer does not keep process alive indefinitely if aborted
  if (timer.unref) timer.unref();

  let res;
  try {
    res = await fetchImpl(target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    // Safe: classify without leaking body/auth; do not include arbitrary text
    if (/timeout|abort/i.test(msg)) {
      return { ok: false, reason: "timeout", safeMessage: "FAIL: request timeout" };
    }
    return { ok: false, reason: "fetch_error", safeMessage: "FAIL: fetch failed" };
  }

  // Redirects must not be followed — any 3xx is failure (no false healthy)
  if (res.status >= 300 && res.status < 400) {
    clearTimeout(timer);
    return { ok: false, reason: "redirect", safeMessage: `FAIL: unexpected redirect ${res.status}` };
  }

  // Status must be 200 — 503/setup must fail
  if (res.status !== 200) {
    clearTimeout(timer);
    // Drain body bounded but do not leak it — we read for safety but discard safely
    // Avoid logging body — just consume to free connection, but bounded
    try { await readBodyLimited(res, bodyLimit, controller.signal); } catch {}
    return { ok: false, reason: "status", safeMessage: `FAIL: status ${res.status} expected 200` };
  }

  // Require no-store to defeat cached readiness
  const cacheControl = res.headers.get("cache-control") || "";
  if (!cacheControl.toLowerCase().includes("no-store")) {
    clearTimeout(timer);
    try { await readBodyLimited(res, bodyLimit, controller.signal); } catch {}
    return { ok: false, reason: "no_store_missing", safeMessage: "FAIL: cache-control no-store missing" };
  }

  // Bounded body read — timeout must include this
  let body;
  try {
    body = await readBodyLimited(res, bodyLimit, controller.signal);
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(msg)) {
      return { ok: false, reason: "timeout", safeMessage: "FAIL: body timeout" };
    }
    return { ok: false, reason: "body_error", safeMessage: "FAIL: body read error" };
  } finally {
    clearTimeout(timer);
  }

  if (body.truncated) {
    return { ok: false, reason: "body_too_large", safeMessage: `FAIL: body exceeds ${bodyLimit} bytes` };
  }

  // JSON parse — malformed must fail, never dump body
  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return { ok: false, reason: "malformed_json", safeMessage: "FAIL: malformed JSON" };
  }

  // Envelope validation: envelope mode === live, data.status ok, data.mode live
  // Any deviation (demo/setup) must fail
  const envelopeMode = payload?.mode;
  const data = payload?.data;
  if (envelopeMode !== "live") {
    return { ok: false, reason: "envelope_mode", safeMessage: `FAIL: envelope mode ${String(envelopeMode ?? "missing")} != live` };
  }
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "missing_data", safeMessage: "FAIL: missing data envelope" };
  }
  if (data.status !== "ok") {
    return { ok: false, reason: "data_status", safeMessage: `FAIL: data.status ${String(data.status ?? "missing")} != ok` };
  }
  if (data.mode !== "live") {
    return { ok: false, reason: "data_mode", safeMessage: `FAIL: data.mode ${String(data.mode ?? "missing")} != live` };
  }

  // All checks passed — live healthy
  return {
    ok: true,
    reason: "healthy",
    safeMessage: `PASS: live healthy at ${url.origin}`,
    details: { origin: url.origin, status: res.status },
  };
}

// CLI entry
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

  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  const cutoffMs = opts.cutoff ? Date.parse(opts.cutoff) : CUTOFF_MS;

  const result = await checkAvailability({
    origin: opts.origin,
    timeout: opts.timeout,
    bodyLimit: opts.bodyLimit,
    nowMs,
    cutoffMs,
  });

  if (opts.json) {
    const out = {
      ok: result.ok,
      skipped: Boolean(result.skipped),
      reason: result.reason,
      message: result.safeMessage,
      origin: opts.origin,
      cutoff: new Date(cutoffMs).toISOString(),
      now: new Date(nowMs).toISOString(),
      // never include body/auth/cookies
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    // Explicit skip distinct from pass
    if (result.skipped) {
      console.log(result.safeMessage);
      console.log(`INFO: cutoff ${new Date(cutoffMs).toISOString()} — scheduled checks stop, manual runs also skip`);
      // exit 0 but distinct log (SKIP vs PASS)
      process.exit(0);
    }
    if (result.ok) {
      console.log(result.safeMessage);
      console.log(`INFO: origin ${opts.origin} is live healthy (mode live, status ok, no-store present)`);
      process.exit(0);
    } else {
      console.log(result.safeMessage);
      // also log safe context without body
      console.log(`INFO: origin ${opts.origin} did not pass live readiness (cutoff ${new Date(cutoffMs).toISOString()})`);
      process.exit(1);
    }
  }

  // json mode exit handling
  if (result.skipped || result.ok) process.exit(0);
  process.exit(1);
}

const isMain = import.meta.main ?? (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href);
if (isMain) {
  main().catch((err) => {
    // Safe fatal — never leak body/auth
    console.error("check-availability fatal: unexpected error");
    // only safe short message
    if (err instanceof Error && err.message) {
      const m = String(err.message).slice(0, 300);
      // redact potential secrets — we only log if it doesn't contain token-like strings
      if (!/eyJ[A-Za-z0-9_\-]{10,}/.test(m) && !m.includes("token") && !m.includes("cookie")) {
        console.error(m);
      }
    }
    process.exit(1);
  });
}
