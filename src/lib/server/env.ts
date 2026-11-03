import "server-only";
import type { AppMode } from "@/lib/marketplace";
import { getDraftProvider } from "@/lib/ai/provider";

export function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim() || "");
  // SUPABASE_ANON_KEY is fallback for compatibility, but spec requires publishable key
  const hasConfig = Boolean(url && publishableKey);
  return { url, publishableKey, hasConfig };
}

export function getAppMode(): AppMode {
  const explicit = process.env.APP_MODE?.trim().toLowerCase();
  if (explicit === "demo" || explicit === "live" || explicit === "setup") {
    return explicit as AppMode;
  }
  const { hasConfig } = getSupabaseEnv();
  if (hasConfig) return "live";
  return "demo";
}

export function isDemoMode(): boolean {
  return getAppMode() === "demo";
}

export function isLiveMode(): boolean {
  return getAppMode() === "live";
}

export { getDraftProvider };

export function getFeatureProviderModel(feature: "draft" | "transcribe" | "cutout" | "moderation"): { provider: "baseten" | "meta"; model: string } {
  if (feature === "transcribe") {
    const m = "muse-voice-transcribe-1.0";
    return { provider: "meta", model: m };
  }
  if (feature === "cutout") {
    const m = "sam-3.1";
    return { provider: "meta", model: m };
  }
  if (feature === "moderation") {
    // Moderation via Baseten not implemented for Meta-only app; keep unavailable unless explicitly routed
    const raw = process.env.AI_MODERATION_PROVIDER?.trim().toLowerCase();
    if (raw === "baseten") {
      const model = process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open-1026";
      return { provider: "baseten", model };
    }
    throw new Error("moderation unavailable: app intent is Meta-only; no approved selector, must stay disabled to avoid charging coding pool");
  }
  // draft
  const provider = getDraftProvider(); // throws if invalid => fail closed
  if (provider === "meta") {
    const model = process.env.META_MODEL?.trim() ?? "";
    // validate model allowlist fail closed
    if (model !== "muse-spark-1.3") throw new Error("invalid meta model");
    return { provider, model };
  }
  const model = process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open-1026";
  return { provider, model };
}

export function getAiFeatureAvailability() {
  const live = getAppMode() === "live";
  const enabled = process.env.AI_ENABLED?.trim().toLowerCase() === "true";
  const capsOk = (() => {
    const daily = Number(process.env.AI_DAILY_LIMIT ?? 50);
    const perUser = Number(process.env.AI_USER_DAILY_LIMIT ?? 5);
    const dailyOk = Number.isSafeInteger(daily) && daily > 0;
    const perUserOk = Number.isSafeInteger(perUser) && perUser > 0;
    return dailyOk && perUserOk;
  })();
  const baseKey = Boolean(process.env.BASETEN_API_KEY?.trim());
  const metaKey = Boolean(process.env.META_API_KEY?.trim());
  // fail closed on invalid provider/model: do not fallback to baseten
  let provider: "baseten" | "meta" | null = null;
  let providerValid = false;
  try {
    provider = getDraftProvider();
    // also validate model for meta
    if (provider === "meta") {
      const m = process.env.META_MODEL?.trim() ?? "";
      if (m !== "muse-spark-1.3") throw new Error("invalid model");
    }
    providerValid = true;
  } catch {
    providerValid = false;
    provider = null;
  }
  const draftKeyOk = (() => {
    if (!providerValid || !provider) return false;
    return provider === "meta" ? metaKey : baseKey;
  })();
  // For draft, require valid provider selection; invalid => unavailable
  const draftAvailable = live && enabled && capsOk && draftKeyOk && providerValid;
  const transcribeAvailable = live && enabled && capsOk && metaKey;
  const cutoutAvailable = live && enabled && capsOk && metaKey;
  // Moderation intentionally unavailable in Meta-only mode; flag explicitly
  const moderationAvailable = false; // live && enabled && capsOk && baseKey would charge coding pool silently -> disabled

  const features = {
    draft: draftAvailable,
    transcribe: transcribeAvailable,
    cutout: cutoutAvailable,
    moderation: moderationAvailable,
  } as const;
  // provider fallback for display only when valid, else null; never pretend baseten when invalid
  const displayProvider = providerValid ? (provider as "baseten" | "meta") : ("baseten" as const);
  // Note: env availability != DB readiness; DB may still be disabled/unconfigured.
  return { ...features, any: Object.values(features).some(Boolean), provider: displayProvider, providerValid, moderationNote: "moderation disabled: app-only Meta intent, no approved moderation selector; charging Baseten coding pool prohibited" };
}

export function getAiEnabled(): boolean {
  return getAiFeatureAvailability().any;
}

export function isAuthConfigured(): boolean {
  const { hasConfig } = getSupabaseEnv();
  return hasConfig && getAppMode() === "live" && process.env.GOOGLE_AUTH_ENABLED === "true";
}

export function getSupabaseStoragePublicBase(): string | null {
  const { url } = getSupabaseEnv();
  if (!url) return null;
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/listing-images`;
}

export function isAiTestMode(): boolean {
  return process.env.AI_TEST_MODE?.trim().toLowerCase() === "true";
}

export function getOwnerAllowlist(): string[] {
  const raw = (process.env.AI_OWNER_ALLOWLIST ?? process.env.TEST_OWNER_ALLOWLIST ?? "").trim();
  if (!raw) return [];
  return raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function isAllowedOwner(email: string | null | undefined, userId?: string | null | undefined): boolean {
  const allowlist = getOwnerAllowlist();
  if (allowlist.length === 0) return false;
  if (email && allowlist.includes(email)) return true;
  if (userId && allowlist.includes(userId)) return true;
  return false;
}

export function getAiMaxRetries(): number {
  if (isAiTestMode()) return 0;
  const raw = Number(process.env.AI_MAX_RETRIES ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(2, Math.max(0, Math.round(raw)));
}
