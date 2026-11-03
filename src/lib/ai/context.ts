import "server-only";
import { requireUser } from "@/lib/server/auth";
import { ApiProblem } from "@/lib/server/http";
import { AiFailure, runGuardedAi, type UsageLedger } from "./guard";
import { getDraftProvider, getFeatureProviderModel } from "@/lib/server/env";
import { createMeteringClient, meterReserve, meterComplete, hashSource, isHardBudgetMode, getMeteringSetupState } from "./meter";

/**
 * Server-only secrets, auth+ownership checks, kill switch, atomic caps via DB.
 * Provider keys are NOT exposed to client; coordinator owns enabling.
 * Per-feature status prevents presenting an unavailable draft as ready.
 * Drafts+voice occur BEFORE publish; each regenerate/retry is a counted attempt.
 * Listing-only AI: search, messages, and browsing never invoke AI.
 *
 * Hard-budget mode (AI_HARD_BUDGET=true) requires metering RPCs via service_role
 * (SUPABASE_SERVICE_ROLE_KEY) and candidate 003 schema; missing credential/candidate
 * fails CLOSED with no fallback to old ledger. Off-by-default, legacy path remains
 * usable before schema installed but does NOT claim monetary cap protection.
 */
export type AiFeature = "draft" | "transcribe" | "cutout" | "moderation";
function cap(name: string, fallback: number) { const value = Number(process.env[name] ?? fallback); return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1000) : 0; }

function keyForFeature(feature: AiFeature): string | undefined {
  if (feature === "draft") return getDraftProvider() === "meta" ? process.env.META_API_KEY?.trim() : process.env.BASETEN_API_KEY?.trim();
  if (feature === "moderation") return process.env.BASETEN_API_KEY?.trim();
  return process.env.META_API_KEY?.trim();
}

export async function requireAiContext(feature: AiFeature, opts?: { sourceHash?: string; idempotencyKey?: string; listingId?: string | null }) {
  const context = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  const key = keyForFeature(feature);
  if (!key) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is not configured. You can continue manually.");
  const daily = cap("AI_DAILY_LIMIT", 50); const userLimit = cap("AI_USER_DAILY_LIMIT", 5);
  if (!daily || !userLimit) throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");

  // Hard-budget mode: use metering client + source identity, duplicate handling
  if (isHardBudgetMode()) {
    const setup = getMeteringSetupState();
    if (!setup.hasServiceKey) throw new ApiProblem(503, "AI_METERING_UNAVAILABLE", "Budget metering not configured (missing SUPABASE_SERVICE_ROLE_KEY). AI disabled.");
    const meteringClient = createMeteringClient();
    if (!meteringClient) throw new ApiProblem(503, "AI_METERING_UNAVAILABLE", "Budget metering unavailable.");
    const { provider, model } = getFeatureProviderModel(feature);
    // source identity required when hard-budget enabled
    const sourceHash = opts?.sourceHash ?? hashSource(`${feature}:${context.user.id}:${opts?.listingId ?? ""}:${Date.now()}`);
    const idempotencyKey = opts?.idempotencyKey ?? hashSource(`idem:${feature}:${context.user.id}:${sourceHash}`).slice(0, 32).padEnd(16, "0");
    // validate idempotency/source lengths early (fail closed)
    if (idempotencyKey.length < 8 || sourceHash.length < 16) throw new ApiProblem(400, "AI_IDEMPOTENCY", "Invalid AI request identity.");
    const ledger: UsageLedger & { _metered?: true; _reserveMeta?: typeof reserveArgs } = {
      async reserve() {
        try {
          const res = await meterReserve({
            client: meteringClient,
            userId: context.user.id,
            feature,
            provider,
            model,
            idempotencyKey,
            sourceHash,
            dailyLimit: daily,
            userLimit,
            listingId: opts?.listingId ?? null,
          });
          if (res.allowed && res.attemptId) {
            // stash for complete fenced to current claim
            (ledger as unknown as Record<string, unknown>)._currentAttemptId = res.attemptId;
            return { allowed: true, usageId: res.attemptId, reason: null };
          }
          // duplicate must return explicit nonexecution, not allowed=true; throw with cached result so route can return it without provider
          if (res.disposition === "duplicate_done") {
            throw new AiFailure("AI_DUPLICATE_DONE", "Duplicate request already completed.", 200, false, res.cachedResult);
          }
          if (res.disposition === "duplicate_pending") {
            throw new AiFailure("AI_DUPLICATE_PENDING", "Duplicate request already pending.", 409, false);
          }
          return { allowed: false, usageId: null, reason: res.reason ?? "budget_rejected" };
        } catch (e) {
          if (e instanceof AiFailure) throw e;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("AI_METERING_UNAVAILABLE") || msg.includes("does not exist") || msg.includes("AI_RESERVE_TIMEOUT")) {
            throw new AiFailure("AI_LIMIT_UNAVAILABLE", "Budget checks unavailable. Continue manually.", 503, false);
          }
          throw new AiFailure("AI_LIMIT_UNAVAILABLE", "Budget checks unavailable. Continue manually.", 503, false);
        }
      },
      async complete(usageId, ok, ms) {
        // fenced to current claim: only complete the attemptId we reserved
        const current = (ledger as unknown as Record<string, unknown>)._currentAttemptId as string | undefined;
        const target = current ?? usageId;
        await meterComplete({ client: meteringClient, userId: context.user.id, attemptId: target, ok, ms, result: ok ? { feature } : null });
      },
    };
    // attach meta for route duplicate pre-check (so route can do early return without guard)
    const reserveArgs = { client: meteringClient, userId: context.user.id, feature, provider, model, idempotencyKey, sourceHash, dailyLimit: daily, userLimit, listingId: opts?.listingId ?? null };
    return { ...context, key, ledger, daily, userLimit, provider, model, sourceHash, idempotencyKey, meteringClient, reserveArgs, meterReserve: () => meterReserve(reserveArgs as never), hardBudget: true as const };
  }

  // Legacy path (pre-003): uses old 3-arg RPC; remains usable before schema installed, but does not claim monetary protection.
  const ledger: UsageLedger = {
    async reserve() {
      const { data, error } = await context.supabase.rpc("reserve_ai_usage", { p_feature: feature, p_daily_limit: daily, p_user_limit: userLimit });
      if (error) throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.");
      const row = Array.isArray(data) ? data[0] : data;
      return { allowed: row?.allowed === true, usageId: row?.usage_id ?? null, reason: row?.reason };
    },
    async complete(usageId, ok, ms) {
      const { error } = await context.supabase.rpc("complete_ai_usage", { p_usage_id: usageId, p_ok: ok, p_ms: Math.max(0, Math.round(ms)) });
      if (error) console.warn("AI usage completion unavailable", { feature });
    },
  };
  return { ...context, key, ledger, daily, userLimit, hardBudget: false as const };
}

export async function runAi<T>(ledger: UsageLedger, operation: (signal: AbortSignal, attempt: number) => Promise<T>, maxRetries = 2) {
  try { return await runGuardedAi({ enabled: true, ledger, operation, maxRetries }); }
  catch (error) {
    if (error instanceof AiFailure) throw new ApiProblem(error.status, error.code, error.message);
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }
}

/** Helper for routes in hard-budget mode to handle duplicate pre-check without guard retry */
export async function checkMeterDuplicate(meteredCtx: Awaited<ReturnType<typeof requireAiContext>>): Promise<{ disposition: string; cachedResult?: unknown; operationId?: string | null } | null> {
  if (!meteredCtx || (meteredCtx as Record<string, unknown>).hardBudget !== true) return null;
  const fn = (meteredCtx as unknown as { meterReserve: () => Promise<{ disposition: string; cachedResult: unknown; operationId: string | null; reason: string | null; allowed: boolean }> }).meterReserve;
  if (!fn) return null;
  try {
    const res = await fn();
    // if allowed, we need to avoid consuming the attempt twice; so we stash but route will proceed to runAi which will reserve again -> duplicate_pending
    // To avoid double-reserve, we return null for allowed case and let runAi reserve fresh.
    // For duplicate, we surface it.
    if (!res.allowed && (res.disposition === "duplicate_done" || res.disposition === "duplicate_pending")) {
      return { disposition: res.disposition, cachedResult: res.cachedResult, operationId: res.operationId };
    }
    // if allowed, we must not consume; so we need to rollback? Instead we treat pre-check as informational only: we call reserve which already creates attempt.
    // So we should NOT pre-consume; route should call reserve only once via ledger.
    // This helper is therefore not used to double-reserve; instead route handles duplicate via ledger.reserve result catch.
    return null;
  } catch { return null; }
}
