import "server-only";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { getAiFeatureAvailability, getAppMode, getOwnerAllowlist, isAiTestMode, isAuthConfigured } from "@/lib/server/env";
import { json, withApi } from "@/lib/server/http";
import type { Profile, SessionInfo } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const mode = getAppMode();
  const availability = getAiFeatureAvailability();
  let ai_enabled = availability.any;
  let ai_features = { draft: availability.draft, transcribe: availability.transcribe, cutout: availability.cutout, moderation: availability.moderation } as const;
  const ai_provider = availability.provider;
  // Hard-budget metering mandatory: no legacy bypass; env-only, must not claim DB ready
  const ai_hard_budget = true;
  const ai_metering_configured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const ai_hard_budget_ready = ai_metering_configured;

  if (mode !== "live") return json({ user: null, mode, ai_enabled: false, auth_configured: false, ai_features: { draft: false, transcribe: false, cutout: false, moderation: false }, ai_provider, ai_hard_budget, ai_metering_configured, ai_hard_budget_ready });
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const data = { user: null, mode, ai_enabled, auth_configured, ai_features, ai_provider, ai_hard_budget, ai_metering_configured, ai_hard_budget_ready } as SessionInfo & Record<string, unknown>;
    return json(data);
  }

  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData?.user ?? null;

  // Owner-only test gate: per-feature visibility only for allowlisted owner after real auth user known (not Profile lacking email)
  if (isAiTestMode()) {
    const allowlist = getOwnerAllowlist();
    const isOwner = Boolean(authUser && ((authUser.email && allowlist.includes(authUser.email)) || allowlist.includes(authUser.id)));
    const allowlistOk = allowlist.length > 0 && isOwner;
    if (!allowlistOk) {
      ai_enabled = false;
      ai_features = { draft: false, transcribe: false, cutout: false, moderation: false };
    }
  }

  if (!authUser) {
    const data = { user: null, mode, ai_enabled, auth_configured, ai_features, ai_provider, ai_hard_budget, ai_metering_configured, ai_hard_budget_ready } as SessionInfo & Record<string, unknown>;
    return json(data);
  }

  // Fetch profile, but never leak email; only safe cols
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, hostel_block, created_at")
    .eq("id", authUser.id)
    .single();

  let user: Profile | null = null;
  if (profile) {
    user = {
      id: profile.id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      hostel_block: profile.hostel_block,
      created_at: profile.created_at,
    };
  } else {
    // Fallback minimal profile if signup trigger hasn't yet created one, but still return something
    user = {
      id: authUser.id,
      display_name: (authUser.user_metadata?.full_name as string) || (authUser.user_metadata?.name as string) || authUser.email?.split("@")[0] || "User",
      avatar_url: (authUser.user_metadata?.avatar_url as string) || null,
      hostel_block: null,
      created_at: authUser.created_at,
    };
  }

  const data = { user, mode, ai_enabled, auth_configured, ai_features, ai_provider, ai_hard_budget, ai_metering_configured, ai_hard_budget_ready } as SessionInfo & Record<string, unknown>;
  return json(data);
});