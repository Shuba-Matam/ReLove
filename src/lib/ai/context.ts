import "server-only";
import { requireUser } from "@/lib/server/auth";
import { ApiProblem } from "@/lib/server/http";
import { AiFailure, runGuardedAi, type UsageLedger } from "./guard";

/**
 * Server-only secrets, auth+ownership checks, kill switch, atomic caps via DB.
 * Provider keys are NOT exposed to client; coordinator owns enabling.
 */
export type AiFeature = "draft" | "transcribe" | "cutout" | "moderation";
function cap(name: string, fallback: number) { const value = Number(process.env[name] ?? fallback); return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1000) : 0; }

export async function requireAiContext(feature: AiFeature) {
  const context = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  const key = feature === "draft" || feature === "moderation" ? process.env.BASETEN_API_KEY : process.env.META_API_KEY;
  if (!key) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is not configured. You can continue manually.");
  const daily = cap("AI_DAILY_LIMIT", 50); const userLimit = cap("AI_USER_DAILY_LIMIT", 5);
  if (!daily || !userLimit) throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can continue manually.");
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
  return { ...context, key, ledger };
}

export async function runAi<T>(ledger: UsageLedger, operation: (signal: AbortSignal, attempt: number) => Promise<T>, maxRetries = 2) {
  try { return await runGuardedAi({ enabled: true, ledger, operation, maxRetries }); }
  catch (error) {
    if (error instanceof AiFailure) throw new ApiProblem(error.status, error.code, error.message);
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }
}
