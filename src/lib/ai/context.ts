import "server-only";
import { requireUser } from "@/lib/server/auth";
import { ApiProblem } from "@/lib/server/http";
import { AiFailure, runMeteredGuarded, type MeteredLedger } from "./guard";
import { getDraftProvider, getFeatureProviderModel, getOwnerAllowlist, isAiTestMode, isAllowedOwner } from "@/lib/server/env";
import { createMeteringClient, meterReserve, meterComplete, hashSource, fetchPricebookRow, enforcePricebookBounds, pricebookFingerprint } from "./meter";
import { PROVIDER_LIMITS } from "./provider";

/**
 * Owner-only test gate: when AI_TEST_MODE=true, only exact verified auth user email/ID in
 * server-configured allowlist may use AI; empty/unknown denies before metering/pricebook/provider.
 * Shared helper for early cached returns to avoid bypass.
 */
export function assertOwnerTestGate(user: { id: string; email?: string | null }): void {
  if (!isAiTestMode()) return;
  const allowlist = getOwnerAllowlist();
  if (allowlist.length === 0) throw new ApiProblem(403, "AI_OWNER_REQUIRED", "AI assistance is not available for this account.");
  const allowed = (user.email && allowlist.includes(user.email)) || allowlist.includes(user.id);
  if (!allowed) throw new ApiProblem(403, "AI_OWNER_REQUIRED", "AI assistance is not available for this account.");
}

/**
 * Server-only secrets, auth+ownership checks, kill switch, atomic caps via DB.
 * Provider keys are NOT exposed to client; coordinator owns enabling.
 * Hard-budget metering is REQUIRED for any AI activation; no legacy monetary bypass.
 * Manual marketplace (listings/threads) remains usable while AI schema uninstalled, but AI fails closed.
 * Metering key only via privileged RPC; no public service_role CRUD.
 */
export type AiFeature = "draft" | "transcribe" | "cutout" | "moderation";

export function aiLimitCap(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1000) : 0;
}

export function getAiUserDailyLimit(user: { id: string; email?: string | null }): number {
  const regularLimit = aiLimitCap("AI_USER_DAILY_LIMIT", 15);
  if (!regularLimit || !isAllowedOwner(user.email, user.id)) return regularLimit;
  const rawOwnerLimit = process.env.AI_OWNER_DAILY_LIMIT;
  if (rawOwnerLimit === undefined) return regularLimit;
  const ownerLimit = Number(rawOwnerLimit);
  return Number.isSafeInteger(ownerLimit) && ownerLimit > 0 && ownerLimit <= 1000 ? ownerLimit : 0;
}

function keyForFeature(feature: AiFeature): string | undefined {
  if (feature === "draft") return getDraftProvider() === "meta" ? process.env.META_API_KEY?.trim() : process.env.BASETEN_API_KEY?.trim();
  if (feature === "moderation") return process.env.BASETEN_API_KEY?.trim();
  return process.env.META_API_KEY?.trim();
}

export async function requireAiContext(feature: AiFeature, opts?: { sourceHash?: string; idempotencyKey?: string; listingId?: string | null }) {
  const context = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  assertOwnerTestGate(context.user);
  const key = keyForFeature(feature);
  if (!key) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is not configured. You can continue manually.");
  const daily = aiLimitCap("AI_DAILY_LIMIT", 50);
  const userLimit = getAiUserDailyLimit(context.user);
  if (!daily || !userLimit) throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");

  const meteringClient = createMeteringClient();
  if (!meteringClient) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");

  const { provider, model } = getFeatureProviderModel(feature);

  const sourceHash = opts?.sourceHash ?? hashSource(`${feature}:${context.user.id}:${opts?.listingId ?? ""}:${Date.now()}`);
  const idempotencyKey = opts?.idempotencyKey ?? hashSource(`idem:${feature}:${context.user.id}:${sourceHash}`).slice(0, 32).padEnd(16, "0");
  if (idempotencyKey.length < 8 || sourceHash.length < 16) throw new ApiProblem(400, "AI_IDEMPOTENCY", "Invalid AI request identity.");

  // Validate pricebook bounds can be fetched; empty/unverified disables with no guessed rows
  // Fetch happens per-request to enforce browser cannot choose price; conservative ceiling must cover all permitted input+output
  // Do NOT claim exact USD guarantee when upstream rates/bounds not verified; fixture costs explicitly not activation config
  let pricebookRow: Awaited<ReturnType<typeof fetchPricebookRow>> | null = null;
  try {
    pricebookRow = await fetchPricebookRow(meteringClient, feature);
  } catch {
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }
  if (!pricebookRow || !pricebookRow.enabled) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  if (pricebookRow.provider !== provider || pricebookRow.model !== model) {
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }

  const expectedVersion = pricebookRow.version ?? 1;
  const expectedFingerprint = pricebookFingerprint(pricebookRow);

  const ledger: MeteredLedger = {
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
          expectedVersion,
          expectedFingerprint,
        });
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("AI_METERING_MALFORMED") || msg.includes("AI_RESERVE_TIMEOUT") || msg.includes("AI_METERING_UNAVAILABLE") || msg.includes("AI_METERING_ERROR") || msg.includes("AI_METERING_EMPTY")) {
          throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, false);
        }
        throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, false);
      }
    },
    async complete(attemptId, ok, ms, result) {
      await meterComplete({ client: meteringClient, userId: context.user.id, attemptId, ok, ms, result: ok ? result : null });
    },
  };

  return {
    ...context,
    key,
    ledger,
    daily,
    userLimit,
    provider,
    model,
    sourceHash,
    idempotencyKey,
    meteringClient,
    pricebookRow,
    hardBudget: true as const,
  };
}

export async function runAi<T>(ledger: MeteredLedger, operation: (signal: AbortSignal, attempt: number) => Promise<T>, opts?: { maxRetries?: number; validateCached?: (cached: unknown) => T | null }): Promise<T> {
  try {
    const effectiveRetries = isAiTestMode() ? 0 : (opts?.maxRetries ?? 1);
    const guarded = await runMeteredGuarded<T>({
      ledger,
      operation,
      validateCached: opts?.validateCached,
      maxRetries: effectiveRetries,
    });
    if (guarded.status === "duplicate_done") {
      const cached = guarded.cached;
      if (opts?.validateCached) {
        const validated = opts.validateCached(cached);
        if (validated === null || validated === undefined) throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
        return validated;
      }
      return cached as T;
    }
    if (guarded.status === "duplicate_pending") {
      throw new ApiProblem(409, "AI_PENDING", "Duplicate request already pending. Try again shortly.");
    }
    return guarded.value;
  } catch (e) {
    if (e instanceof ApiProblem) throw e;
    if (e instanceof AiFailure) {
      throw new ApiProblem(e.status, e.code, e.message);
    }
    throw e;
  }
}

// Helper to enforce trusted server-validated usage dimensions before provider
export function assertTrustedBounds(
  pricebookRow: Awaited<ReturnType<typeof fetchPricebookRow>>,
  dimensions: { inputChars?: number; outputTokens?: number; audioDurationSec?: number; imageBytes?: number; imageWidth?: number; imageHeight?: number }
): void {
  try {
    enforcePricebookBounds(pricebookRow, dimensions, {
      maxImageBytes: PROVIDER_LIMITS.maxImageBytes,
      maxAudioBytes: PROVIDER_LIMITS.maxAudioBytes,
      maxOutputTokens: PROVIDER_LIMITS.maxTokens,
      maxImageSide: PROVIDER_LIMITS.maxImageSide,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AI_PRICEBOOK_UNAVAILABLE") || msg.includes("AI_BOUNDS_EXCEEDED")) {
      // Reject exceeding configured envelope BEFORE provider; provider uses same limits
      // For image drafts verify actual image dimensions<=1600, not comment only
      throw new ApiProblem(400, "AI_BOUNDS", "Request exceeds AI processing limits. Continue manually or adjust input.");
    }
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }
}
