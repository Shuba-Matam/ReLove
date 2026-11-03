#!/usr/bin/env node
// A read-only, single-request health probe. No credentials or provider calls.
import { pathToFileURL } from "node:url";

export const CANONICAL_ORIGIN = "https://re-love-pi.vercel.app";
export const CUTOFF_ISO = "2026-11-17T00:00:00.000Z";
export const CUTOFF_MS = Date.parse(CUTOFF_ISO);
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_BODY_LIMIT_BYTES = 32_768;
export const HEALTH_PATH = "/api/health";

const HELP = `check-availability — one bounded GET /api/health

Usage: node scripts/check-availability.mjs [options]
  --origin=URL        Bare HTTPS origin, or HTTP loopback for local checks
                      Default: ${CANONICAL_ORIGIN}
  --timeout=MS        Total request/body deadline, 1000..30000 (default 5000)
  --body-limit=BYTES  Response limit, 1024..1048576 (default 32768)
  --json              Safe structured result
  --help, -h          Show help

Requires HTTP 200, a no-store response directive, and a healthy live envelope.
No redirects, retries, Authorization or Cookie headers.
The fixed cutoff is ${CUTOFF_ISO}; no health requests on or after it.
Exit 0: PASS or explicit SKIP after cutoff. Exit 1: FAIL. Exit 2: usage error.`;

export function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}

export function isExpired(nowMs, cutoffMs = CUTOFF_MS) {
  // Tests can inject a clock and shorten the window, but not extend the cutoff.
  return !Number.isFinite(nowMs) || !Number.isFinite(cutoffMs)
    || nowMs >= Math.min(cutoffMs, CUTOFF_MS);
}

export function validateOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) {
    throw new Error("origin invalid: must be non-empty URL string");
  }
  const raw = origin.trim();
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("origin invalid: must be valid URL"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("origin invalid: must be https or http");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("origin invalid: http only allowed for loopback");
  }
  if (url.username || url.password || raw.includes("@")) {
    throw new Error("origin invalid: must not contain userinfo");
  }
  if (raw.includes("?")) throw new Error("origin invalid: must not contain query");
  if (raw.includes("#")) throw new Error("origin invalid: must not contain hash");
  // Validate before normalization can erase dot segments or backslashes.
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(raw)) {
    throw new Error("origin invalid: must not contain path");
  }
  return url;
}

export function parseArgs(argv) {
  const opts = {
    origin: CANONICAL_ORIGIN, timeout: DEFAULT_TIMEOUT_MS,
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES, json: false, help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--origin=")) opts.origin = arg.slice(9);
    else if (arg.startsWith("--timeout=")) opts.timeout = Number(arg.slice(10));
    else if (arg.startsWith("--body-limit=")) opts.bodyLimit = Number(arg.slice(13));
    else throw new Error("unknown option or argument");
  }
  if (!Number.isInteger(opts.timeout) || opts.timeout < 1000 || opts.timeout > 30000) {
    throw new Error("--timeout must be integer 1000..30000 ms");
  }
  if (!Number.isInteger(opts.bodyLimit) || opts.bodyLimit < 1024 || opts.bodyLimit > 1_048_576) {
    throw new Error("--body-limit must be integer 1024..1048576 bytes");
  }
  return opts;
}

function fail(reason, message) {
  return { ok: false, reason, safeMessage: `FAIL: ${message}` };
}

async function readBodyLimited(res, limit, signal) {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), truncated: false };
      total += value.byteLength;
      if (total > limit) return { text: "", truncated: true };
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Cancellation must never hold the result past the deadline.
    void reader.cancel().catch(() => {});
  }
}

export async function checkAvailability({
  origin = CANONICAL_ORIGIN,
  timeout = DEFAULT_TIMEOUT_MS,
  bodyLimit = DEFAULT_BODY_LIMIT_BYTES,
  fetchImpl = fetch,
  nowMs = Date.now(),
  cutoffMs = CUTOFF_MS,
} = {}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(cutoffMs)) {
    return fail("invalid_clock", "invalid clock");
  }
  if (isExpired(nowMs, cutoffMs)) {
    return { ok: false, skipped: true, reason: "expired", safeMessage: "SKIP: availability window closed; no health request made" };
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000
    || !Number.isInteger(bodyLimit) || bodyLimit < 1 || bodyLimit > 1_048_576) {
    return fail("invalid_limits", "invalid request limits");
  }
  let url;
  try { url = validateOrigin(origin); }
  catch { return fail("invalid_origin", "invalid origin"); }

  const controller = new AbortController();
  let response;
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fail("timeout", "request or body timeout"));
    }, timeout);
  });
  const probe = async () => {
    try {
      response = await fetchImpl(`${url.origin}${HEALTH_PATH}`, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { Accept: "application/json", "Cache-Control": "no-store", Pragma: "no-cache" },
      });
    } catch {
      return controller.signal.aborted
        ? fail("timeout", "request timeout") : fail("fetch_error", "fetch failed");
    }
    // Reject from headers without draining possibly endless error responses.
    if (response.status >= 300 && response.status < 400) return fail("redirect", "unexpected redirect");
    if (response.status !== 200) return fail("status", "status must be 200");
    const directives = (response.headers.get("cache-control") || "").split(",").map((value) => value.trim().toLowerCase());
    if (!directives.includes("no-store")) return fail("no_store_missing", "cache-control no-store missing");

    let body;
    try { body = await readBodyLimited(response, bodyLimit, controller.signal); }
    catch {
      return controller.signal.aborted
        ? fail("timeout", "body timeout") : fail("body_error", "body read error");
    }
    if (body.truncated) return fail("body_too_large", "body exceeds byte limit");
    let payload;
    try { payload = JSON.parse(body.text); }
    catch { return fail("malformed_json", "malformed JSON"); }
    if (payload?.mode !== "live") return fail("envelope_mode", "envelope mode must be live");
    const data = payload?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("missing_data", "missing data envelope");
    if (data.status !== "ok") return fail("data_status", "data status must be ok");
    if (data.mode !== "live") return fail("data_mode", "data mode must be live");
    return { ok: true, reason: "healthy", safeMessage: "PASS: live healthy", details: { status: 200 } };
  };

  try { return await Promise.race([probe(), deadline]); }
  catch { return fail("response_error", "invalid response"); }
  finally {
    clearTimeout(timer);
    controller.abort();
    // Early rejection releases sockets without reading or logging the body.
    if (response?.body && !response.body.locked && typeof response.body.cancel === "function") {
      void response.body.cancel().catch(() => {});
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); }
  catch (error) {
    // parseArgs emits only fixed messages, never the untrusted argument.
    console.error(`error: ${error.message}`);
    return 2;
  }
  if (opts.help) { console.log(HELP); return 0; }
  const result = await checkAvailability(opts);
  if (opts.json) console.log(JSON.stringify({ ...result, cutoff: CUTOFF_ISO }));
  else console.log(result.safeMessage);
  return result.ok || result.skipped ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error("FAIL: unexpected availability check error");
    process.exitCode = 1;
  });
}
