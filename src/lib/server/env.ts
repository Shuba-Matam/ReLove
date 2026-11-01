import "server-only";
import type { AppMode } from "@/lib/marketplace";

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

export function getAiEnabled(): boolean {
  const raw = process.env.AI_ENABLED?.trim().toLowerCase();
  return getAppMode() === "live" && raw === "true" && Boolean(process.env.BASETEN_API_KEY || process.env.META_API_KEY);
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
