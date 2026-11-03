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
  let provider: "baseten" | "meta" = "baseten";
  try { provider = getDraftProvider(); } catch { provider = "baseten"; }
  const draftKeyOk = (() => {
    try { return provider === "meta" ? metaKey : baseKey; } catch { return false; }
  })();
  const features = {
    draft: live && enabled && capsOk && draftKeyOk,
    transcribe: live && enabled && capsOk && metaKey,
    cutout: live && enabled && capsOk && metaKey,
    moderation: live && enabled && capsOk && baseKey,
  } as const;
  return { ...features, any: Object.values(features).some(Boolean), provider };
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
