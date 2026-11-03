#!/usr/bin/env node
/**
 * Re-Love env validator
 * Dependency-free Node 22.14+ ESM CLI.
 * Validates APP_MODE, Supabase, auth/AI flags, caps, provider keys,
 * rejects forbidden NEXT_PUBLIC credentials and service_role misuse.
 * Never prints secret values.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-env.mjs
 *   node --env-file-if-exists=.env.local scripts/check-env.mjs --help
 *
 * Env is NOT parsed here. Use Node's built-in --env-file[-if-exists].
 */

const FORBIDDEN_NEXT_PUBLIC = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_KEY",
  "NEXT_PUBLIC_BASETEN_API_KEY",
  "NEXT_PUBLIC_META_API_KEY",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  "NEXT_PUBLIC_GOOGLE_CLIENT_SECRET",
];

const SENSITIVE_PATTERNS = ["SUPABASE", "BASETEN", "META_API", "GOOGLE", "SERVICE_ROLE", "SECRET", "API_KEY"];

// Allow-list of known Next.js public vars that are intentional (not secrets)
const ALLOWED_NEXT_PUBLIC = new Set([]);

const HELP = `
check-env — validate Re-Love server environment

Usage:
  node --env-file=.env.local scripts/check-env.mjs [options]
  node --env-file-if-exists=.env.local scripts/check-env.mjs [options]

Options:
  --help, -h     Show this help
  --json         Output machine-readable JSON (no secrets)
  --strict       Extra warnings become failures (e.g. missing optional AI keys in live)

Environment loading:
  This script does NOT implement a custom dotenv parser.
  Use Node 22.14+ flags:
    --env-file=.env.local
    --env-file-if-exists=.env.local
  Or export variables in your shell before running.

Validated:
  APP_MODE                demo|live (setup code remains but deploy uses demo/live)
  SUPABASE_URL            required in live, https except localhost/127.0.0.1
  SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY fallback) required in live
  GOOGLE_AUTH_ENABLED     true|false (live expects true)
  AI_ENABLED              true|false (current release expects false)
  AI_DAILY_LIMIT          integer 0..1000 (0=off, default 50 if unset)
  AI_USER_DAILY_LIMIT     integer 0..1000 (0=off, default 5 if unset)
  BASETEN_API_KEY         required if AI_ENABLED=true for draft/moderation
  META_API_KEY            required if AI_ENABLED=true for transcribe/cutout
  BASETEN_MODEL           optional, defaults meta-models/muse-spark-open-1026
  Rejects NEXT_PUBLIC_* credentials and service_role key used as publishable key
  Warns if repo appears to contain credentials (.env.local tracked, .env.example with long tokens)

Exit codes:
  0  all checks passed
  1  validation failure
  2  usage error

Examples:
  node --env-file-if-exists=.env.local scripts/check-env.mjs
  node scripts/check-env.mjs --help
`.trim();

function parseArgs(argv) {
  const opts = { help: false, json: false, strict: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--strict") opts.strict = true;
    else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return opts;
}

function maskPresence(value) {
  if (!value) return "unset";
  const t = value.trim();
  if (!t) return "empty";
  return `set (${t.length} chars)`;
}

function isTruthyFlag(value) {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off", ""].includes(v)) return false;
  return null; // invalid
}

function isValidAppMode(v) {
  if (!v) return { mode: "demo", explicit: false };
  const m = v.trim().toLowerCase();
  if (["demo", "setup", "live"].includes(m)) return { mode: m, explicit: true, raw: v };
  return { mode: null, explicit: true, raw: v, invalid: true };
}

function tryParseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname.toLowerCase());
}

function decodeJwtRoleNoValue(keyMaterial) {
  // Never returns or logs key; only inspects role claim if JWT-shaped.
  try {
    const parts = keyMaterial.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // base64url decode
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const b64 = padded + "=".repeat(padLen);
    const json = Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(json);
    if (obj && typeof obj.role === "string") return obj.role;
    return null;
  } catch {
    return null;
  }
}

function looksLikeServiceRole(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  if (lower.includes("service_role")) return true;
  const role = decodeJwtRoleNoValue(value);
  if (role === "service_role") return true;
  return false;
}

function validateNumericCap(name, raw, defaultNote = "") {
  if (raw === undefined || raw === "") {
    return { ok: true, value: null, note: `unset — runtime default applies${defaultNote}` };
  }
  const trimmed = raw.trim();
  // Allow numeric string with optional whitespace
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, reason: `${name} must be an integer 0..1000 (got non-integer)` };
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1000) {
    return { ok: false, reason: `${name} must be integer 0..1000` };
  }
  // 0 allowed explicitly (means off)
  return { ok: true, value: n, note: String(n) };
}

function checkForbiddenNextPublic(env) {
  const errors = [];
  const warnings = [];
  for (const key of FORBIDDEN_NEXT_PUBLIC) {
    if (env[key] !== undefined && env[key] !== "") {
      errors.push(`Forbidden public credential: ${key} must not be set (server env only, never NEXT_PUBLIC)`);
    }
  }
  // Dynamic scan for suspicious NEXT_PUBLIC_* containing sensitive fragments
  for (const k of Object.keys(env)) {
    if (!k.startsWith("NEXT_PUBLIC_")) continue;
    if (ALLOWED_NEXT_PUBLIC.has(k)) continue;
    if (FORBIDDEN_NEXT_PUBLIC.includes(k)) continue; // already errored
    const upper = k.toUpperCase();
    for (const pat of SENSITIVE_PATTERNS) {
      if (upper.includes(pat)) {
        warnings.push(`Suspicious public var: ${k} contains "${pat}" — ensure server secrets are not exposed via NEXT_PUBLIC_`);
        break;
      }
    }
  }
  return { errors, warnings };
}

async function checkRepoLeakage() {
  // Lightweight repo hygiene checks: no credentials committed, .env.local gitignored.
  const warnings = [];
  const errors = [];
  const { readFileSync, existsSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname ?? ".", "..");

  // Check .env.example doesn't contain real-looking JWT/token (length heuristic)
  const examplePath = path.join(root, ".env.example");
  if (existsSync(examplePath)) {
    try {
      const content = readFileSync(examplePath, "utf8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, "").trim();
        // Heuristic: real key would be long base64/JWT; example should be empty or placeholder
        if (val.length > 20 && !/^<.*>$/.test(val) && !/^(your-|example|placeholder|xxx|change_me)/i.test(val)) {
          // Look for JWT shape or long alphanumeric with dots/dashes
          if (val.length > 40 || val.includes("eyJ") || /^[A-Za-z0-9_\-]{40,}$/.test(val)) {
            warnings.push(`.env.example: ${m[1]} appears to contain a non-placeholder value — ensure no real secret is committed`);
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }

  // Check .gitignore contains .env.local
  const giPath = path.join(root, ".gitignore");
  if (existsSync(giPath)) {
    try {
      const gi = readFileSync(giPath, "utf8");
      if (!gi.split(/\r?\n/).some((l) => l.trim() === ".env.local" || l.includes(".env*.local"))) {
        warnings.push(".gitignore missing .env.local — local credentials must be gitignored");
      }
    } catch {}
  } else {
    warnings.push("No .gitignore found — ensure .env.local is ignored");
  }

  // Check .env.local is not tracked (if git repo)
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    try {
      const tracked = execSync("git ls-files --error-unmatch .env.local", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (tracked) errors.push(".env.local is tracked by git — must be removed from index and ignored");
    } catch {
      // not tracked is the expected case — ignore error
    }
    // Also check any .env files tracked
    try {
      const envFiles = execSync("git ls-files | grep -E \"(^|/)\\.env\"", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (envFiles) {
        const lines = envFiles.split("\n").filter(Boolean);
        // .env.example is allowed
        const bad = lines.filter((f) => f !== ".env.example" && !f.endsWith(".env.example") && !f.includes(".env.test"));
        if (bad.length) warnings.push(`Repo tracks env file(s): ${bad.join(", ")} — ensure no secret file is committed`);
      }
    } catch {}
  } catch {
    // not a git repo
  }

  return { errors, warnings };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    console.error(`Run with --help for usage.`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  const env = process.env;
  const errors = [];
  const warnings = [];
  const infos = [];

  // 1. APP_MODE
  const appModeRes = isValidAppMode(env.APP_MODE);
  if (appModeRes.invalid) {
    errors.push(`APP_MODE invalid: "${appModeRes.raw}" — must be demo|setup|live (case-insensitive) or unset for demo`);
  }
  const effectiveMode = appModeRes.mode ?? "demo";
  if (!appModeRes.explicit) {
    // infer from hasConfig: but don't require; just info
    const hasConfigProbe = Boolean((env.SUPABASE_URL?.trim() || "") && ((env.SUPABASE_PUBLISHABLE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim()) ?? ""));
    if (hasConfigProbe) infos.push(`APP_MODE unset → inferred effective "${effectiveMode}" (has Supabase config would be live, per src/lib/server/env.ts)`);
    else infos.push(`APP_MODE unset → demo (no Supabase config, per spec demo must work with no env)`);
  } else {
    infos.push(`APP_MODE=${effectiveMode}${appModeRes.explicit ? " (explicit)" : ""}`);
  }

  // 2. SUPABASE URL + key (required for live)
  const supabaseUrlRaw = (env.SUPABASE_URL ?? "").trim();
  const publishable = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? "").trim();
  const anonFallbackUsed = !env.SUPABASE_PUBLISHABLE_KEY?.trim() && Boolean(env.SUPABASE_ANON_KEY?.trim());
  const hasConfig = Boolean(supabaseUrlRaw && publishable);

  if (effectiveMode === "live") {
    if (!supabaseUrlRaw) errors.push("SUPABASE_URL is required in live mode");
    if (!publishable) errors.push("SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY fallback) is required in live mode");
    if (anonFallbackUsed && publishable) infos.push("SUPABASE_ANON_KEY fallback in use — prefer SUPABASE_PUBLISHABLE_KEY");
  } else {
    if (supabaseUrlRaw || publishable) infos.push(`Supabase config present in ${effectiveMode} mode — will be validated but not required`);
    else infos.push(`${effectiveMode} mode with no Supabase config — allowed`);
  }

  // Supabase URL shape when present (any mode if set)
  if (supabaseUrlRaw) {
    const parsed = tryParseUrl(supabaseUrlRaw);
    if (!parsed) {
      errors.push("SUPABASE_URL must be a valid URL");
    } else {
      const hostname = parsed.hostname;
      const proto = parsed.protocol;
      if (proto !== "https:" && !isLocalHost(hostname)) {
        errors.push("SUPABASE_URL must use https (http allowed only for localhost/127.0.0.1 development)");
      } else if (proto !== "https:" && isLocalHost(hostname)) {
        warnings.push("SUPABASE_URL uses http on localhost — allowed for development only");
      }
      if (!hostname.includes(".")) {
        warnings.push("SUPABASE_URL hostname looks unusual — expected *.supabase.co");
      }
      infos.push(`SUPABASE_URL host=${hostname} proto=${proto} ${maskPresence(supabaseUrlRaw)}`);
    }
  }

  if (publishable) {
    // Must not be service_role
    if (looksLikeServiceRole(publishable)) {
      errors.push("SUPABASE_PUBLISHABLE_KEY must not be a service_role key (role=service_role detected, or value contains service_role)");
    }
    // Basic shape: JWT has 3 dot parts, anon key length heuristic
    if (!publishable.includes(".") && publishable.length < 20) {
      warnings.push("SUPABASE_PUBLISHABLE_KEY looks unusually short — verify publishable/anon key");
    }
    infos.push(`Supabase publishable key: ${maskPresence(publishable)}${anonFallbackUsed ? " (via ANON fallback)" : ""}`);
  }

  // Explicit service role env var should not be present in app env (server secret, but not needed for demo)
  // Check forbidden separate: but SUPABASE_SERVICE_ROLE_KEY being set is actually ok for server? However task says reject service-role use as publishable key.
  // We do not error if SUPABASE_SERVICE_ROLE_KEY exists separately, but warn if it equals publishable.
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (serviceRoleKey) {
    if (publishable && serviceRoleKey === publishable) {
      errors.push("SUPABASE_SERVICE_ROLE_KEY must not equal publishable key");
    } else {
      warnings.push("SUPABASE_SERVICE_ROLE_KEY is set — ensure it is server-only and never exposed as publishable key or NEXT_PUBLIC");
    }
  }

  // 3. GOOGLE_AUTH_ENABLED flag
  const googleFlagRaw = env.GOOGLE_AUTH_ENABLED;
  const googleFlag = isTruthyFlag(googleFlagRaw);
  if (googleFlagRaw !== undefined && googleFlag === null) {
    // Invalid flag value
    errors.push("GOOGLE_AUTH_ENABLED must be true|false (or 1/0) if set");
  } else if (googleFlagRaw !== undefined) {
    infos.push(`GOOGLE_AUTH_ENABLED=${googleFlag ? "true" : "false"}`);
  } else {
    infos.push("GOOGLE_AUTH_ENABLED unset — defaults to disabled");
  }

  // If live and googleFlag true, need supabase hasConfig but already validated
  if (effectiveMode === "live" && googleFlag === true && !hasConfig) {
    errors.push("GOOGLE_AUTH_ENABLED=true in live requires Supabase URL and publishable key");
  }

  // 4. AI_ENABLED flag
  const aiFlagRaw = env.AI_ENABLED;
  const aiFlag = isTruthyFlag(aiFlagRaw);
  if (aiFlagRaw !== undefined && aiFlag === null) {
    errors.push("AI_ENABLED must be true|false if set");
  } else if (aiFlagRaw !== undefined) {
    infos.push(`AI_ENABLED=${aiFlag ? "true" : "false"}`);
  } else {
    infos.push("AI_ENABLED unset — defaults to disabled");
  }

  // 5. AI caps — actual vars from src/lib/ai/context.ts
  const dailyRes = validateNumericCap("AI_DAILY_LIMIT", env.AI_DAILY_LIMIT, " (50)");
  if (!dailyRes.ok) errors.push(dailyRes.reason);
  else infos.push(`AI_DAILY_LIMIT: ${dailyRes.note === null ? "unset" : dailyRes.note} — ${dailyRes.note ? maskPresence(env.AI_DAILY_LIMIT ?? "") + " " + dailyRes.note : dailyRes.note}`);

  const userRes = validateNumericCap("AI_USER_DAILY_LIMIT", env.AI_USER_DAILY_LIMIT, " (5)");
  if (!userRes.ok) errors.push(userRes.reason);
  else infos.push(`AI_USER_DAILY_LIMIT: ${userRes.note === null ? "unset" : userRes.note} — ${userRes.note ? maskPresence(env.AI_USER_DAILY_LIMIT ?? "") + " " + userRes.note : userRes.note}`);

  // Additional AI caps: AI caps validated, allow zero cap (off) if runtime permits
  // In context.ts cap() returns 0 for zero, and then throws AI_DISABLED. So zero is valid as "off".
  // We already allow 0..1000.
  if (dailyRes.value === 0 || userRes.value === 0) {
    infos.push("AI caps 0 means off — runtime will treat as disabled (per src/lib/ai/context.ts cap() logic)");
  }

  // 6. Provider credentials conditional on enabled features
  const basetenKey = (env.BASETEN_API_KEY ?? "").trim();
  const metaKey = (env.META_API_KEY ?? "").trim();
  const basetenModel = (env.BASETEN_MODEL ?? "").trim();
  if (basetenModel) {
    if (basetenModel.length < 3 || basetenModel.length > 120) {
      warnings.push("BASETEN_MODEL unusually short/long — expected model id like meta-models/muse-spark-open-1026");
    } else {
      infos.push(`BASETEN_MODEL: set (${basetenModel.length} chars)`);
    }
  } else {
    infos.push("BASETEN_MODEL unset — runtime default meta-models/muse-spark-open-1026 applies when AI enabled");
  }
  const draftProvider = (env.AI_DRAFT_PROVIDER ?? "").trim().toLowerCase();
  if (draftProvider) {
    if (!["baseten", "meta"].includes(draftProvider)) {
      errors.push(`AI_DRAFT_PROVIDER must be baseten|meta if set (got "${draftProvider}")`);
    } else {
      infos.push(`AI_DRAFT_PROVIDER=${draftProvider} (default baseten; meta muse-spark-1.3 approved for drafts, all gates remain off)`);
      if (draftProvider === "meta" && !metaKey) warnings.push("AI_DRAFT_PROVIDER=meta requires META_API_KEY — draft will be unavailable until coordinator supplies key");
      if (draftProvider === "meta" && metaKey) infos.push("Meta draft provider selected — requires META_MODEL=muse-spark-1.3 standard (no Contributor); all gates remain off until activation");
    }
    const metaModel = (env.META_MODEL ?? "").trim();
    if (draftProvider === "meta") {
      if (!metaModel) warnings.push("AI_DRAFT_PROVIDER=meta requires META_MODEL=muse-spark-1.3 — unspecified model fails closed");
      else if (metaModel !== "muse-spark-1.3") errors.push(`META_MODEL must be muse-spark-1.3 when AI_DRAFT_PROVIDER=meta (got "${metaModel}") — invalid model fails closed`);
      else infos.push(`META_MODEL: ${metaModel} (allowlisted)`);
    } else if (metaModel) {
      infos.push(`META_MODEL set but ignored for baseten provider (${metaModel.length} chars)`);
    }
    if ((env.META_CHAT_ENDPOINT ?? "").trim()) {
      errors.push("META_CHAT_ENDPOINT is not allowed — endpoint is fixed to https://api.meta.ai/v1/chat/completions; remove this variable");
    }
  } else {
    infos.push("AI_DRAFT_PROVIDER unset — defaults to baseten");
    if ((env.META_MODEL ?? "").trim()) infos.push(`META_MODEL set but ignored without AI_DRAFT_PROVIDER=meta`);
    if ((env.META_CHAT_ENDPOINT ?? "").trim()) errors.push("META_CHAT_ENDPOINT is not allowed — remove this variable");
  }

  // Hard-budget metering credential (serviceRoleKey already declared above)
  const hardBudgetRaw = env.AI_HARD_BUDGET?.trim().toLowerCase();
  const hardBudget = hardBudgetRaw === "true";
  if (env.AI_HARD_BUDGET !== undefined && hardBudgetRaw !== "true" && hardBudgetRaw !== "false" && hardBudgetRaw !== "") {
    errors.push("AI_HARD_BUDGET must be true|false if set (default false)");
  }
  if (hardBudget) {
    if (!serviceRoleKey) errors.push("AI_HARD_BUDGET=true requires SUPABASE_SERVICE_ROLE_KEY (server-only, never NEXT_PUBLIC) for metering RPCs; missing fails closed");
    else infos.push(`AI_HARD_BUDGET=true with ${maskPresence(serviceRoleKey)} (service_role metering via docs/drafts/003)`);
    infos.push("Hard-budget ON: candidate 003 monetary caps enforce; legacy reserve_ai_usage revoked; missing pricebook/caps fails closed");
  } else {
    infos.push("AI_HARD_BUDGET off (default): legacy per-day caps via reserve_ai_usage remain usable before 003, but do not claim micro-USD protection; see /api/session ai_hard_budget_ready");
    if (serviceRoleKey) infos.push(`SUPABASE_SERVICE_ROLE_KEY present but ignored until AI_HARD_BUDGET=true (${maskPresence(serviceRoleKey)})`);
  }
  // Moderation intentionally disabled in Meta-only mode
  infos.push("Moderation disabled: app-only Meta intent, no approved selector; charging Baseten coding pool prohibited (see src/lib/server/env.ts)");

  if (aiFlag === true) {
    if (!basetenKey && !metaKey) {
      const msg = "AI_ENABLED=true requires at least one provider key (BASETEN_API_KEY for draft/moderation or META_API_KEY for transcribe/cutout), per src/lib/ai/context.ts and src/lib/server/env.ts";
      if (opts.strict) errors.push(msg);
      else warnings.push(msg);
    } else {
      if (!basetenKey) warnings.push("BASETEN_API_KEY unset — AI draft will be unavailable for baseten provider (requires BASETEN_API_KEY per src/lib/ai/context.ts)");
      else infos.push(`BASETEN_API_KEY: ${maskPresence(basetenKey)}`);
      if (!metaKey) warnings.push("META_API_KEY unset — transcribe/cutout will be unavailable (requires META_API_KEY)");
      else infos.push(`META_API_KEY: ${maskPresence(metaKey)}`);
      const feats = [];
      const provider = draftProvider === "meta" ? "meta" : "baseten";
      if ((provider === "meta" ? metaKey : basetenKey)) feats.push("draft");
      if (metaKey) feats.push("transcribe/cutout");
      // moderation intentionally not listed when hard budget off or app-only
      if (feats.length) infos.push(`AI features env-available: ${feats.join(", ")} (DB caps still required; moderation unavailable)`);
    }
    // Also check that caps are non-zero if AI enabled? In context.ts, if caps zero then AI throws disabled even with key.
    if (dailyRes.value === 0 || userRes.value === 0) {
      warnings.push("AI_ENABLED=true but AI_DAILY_LIMIT or AI_USER_DAILY_LIMIT is 0 — runtime will disable AI (cap returns 0). Set >0 or disable AI_ENABLED.");
    }
    if (dailyRes.value !== null && dailyRes.value !== 0 && dailyRes.value < 50) infos.push("AI_DAILY_LIMIT below default 50 — ensure reserve for judging remains (see docs/AI-BUDGET-PROPOSAL.md)");
  } else {
    // AI disabled: keys should not be required, but warn if dangling?
    if (basetenKey || metaKey) {
      infos.push(`AI_ENABLED off but provider key(s) present — ignored until enabled: ${[basetenKey ? "BASETEN" : null, metaKey ? "META" : null].filter(Boolean).join(", ")}`);
    }
    // Still warn about caps invalid already handled
  }

  // 7. Forbidden NEXT_PUBLIC credentials
  const nextPub = checkForbiddenNextPublic(env);
  errors.push(...nextPub.errors);
  warnings.push(...nextPub.warnings);

  // 8. Repo leakage checks
  const repoChecks = await checkRepoLeakage();
  errors.push(...repoChecks.errors);
  warnings.push(...repoChecks.warnings);

  // Demo must work with no env: if effectiveMode demo and minimal env, we should pass.
  // Already handled; just add info
  const isDemoNoEnv = effectiveMode === "demo" && !hasConfig;
  if (isDemoNoEnv) infos.push("Demo mode requires no env — health and listings will serve sample data (per src/lib/server/queries.ts)");

  const ok = errors.length === 0;

  if (opts.json) {
    const payload = {
      ok,
      mode: effectiveMode,
      hasConfig,
      errors,
      warnings,
      infos,
      envPresence: {
        SUPABASE_URL: maskPresence(env.SUPABASE_URL),
        SUPABASE_PUBLISHABLE_KEY: maskPresence(env.SUPABASE_PUBLISHABLE_KEY),
        SUPABASE_ANON_KEY: maskPresence(env.SUPABASE_ANON_KEY),
        GOOGLE_AUTH_ENABLED: maskPresence(env.GOOGLE_AUTH_ENABLED),
        AI_ENABLED: maskPresence(env.AI_ENABLED),
        AI_DAILY_LIMIT: maskPresence(env.AI_DAILY_LIMIT),
        AI_USER_DAILY_LIMIT: maskPresence(env.AI_USER_DAILY_LIMIT),
        AI_DRAFT_PROVIDER: maskPresence(env.AI_DRAFT_PROVIDER),
        BASETEN_API_KEY: maskPresence(env.BASETEN_API_KEY),
        BASETEN_MODEL: maskPresence(env.BASETEN_MODEL),
        META_API_KEY: maskPresence(env.META_API_KEY),
        META_MODEL: maskPresence(env.META_MODEL),
        META_CHAT_ENDPOINT: maskPresence(env.META_CHAT_ENDPOINT),
        AI_HARD_BUDGET: maskPresence(env.AI_HARD_BUDGET),
        SUPABASE_SERVICE_ROLE_KEY: maskPresence(env.SUPABASE_SERVICE_ROLE_KEY),
      },
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Re-Love env check — mode=${effectiveMode} hasConfig=${hasConfig}`);
    console.log("-".repeat(48));
    if (errors.length === 0 && warnings.length === 0) {
      console.log("✓ All checks passed.");
    } else {
      for (const e of errors) console.log(`✗ ${e}`);
      for (const w of warnings) console.log(`⚠ ${w}`);
    }
    if (infos.length) {
      console.log("\nInfo:");
      for (const i of infos) console.log(`  · ${i}`);
    }
    console.log("");
    console.log(`Result: ${ok ? "PASS" : "FAIL"} (${errors.length} error(s), ${warnings.length} warning(s))`);
    if (!ok) {
      console.log("\nFix errors and re-run:");
      console.log("  node --env-file-if-exists=.env.local scripts/check-env.mjs");
    } else if (warnings.length) {
      console.log("\nWarnings do not block demo but should be addressed before live deploy.");
    }
    console.log("\nNote: Env is loaded via Node --env-file[-if-exists], not a custom dotenv parser.");
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  // Never print secret values or raw errors with values
  console.error("check-env fatal: unexpected error");
  if (err instanceof Error && err.message && !err.message.includes("=")) {
    console.error(err.message.slice(0, 500));
  }
  process.exit(1);
});
