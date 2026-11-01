import "server-only";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { getAppMode, getAiEnabled, isAuthConfigured } from "@/lib/server/env";
import { json, withApi } from "@/lib/server/http";
import type { Profile, SessionInfo } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const mode = getAppMode();
  const ai_enabled = getAiEnabled();
  const auth_configured = isAuthConfigured();

  if(mode !== "live") return json({ user:null, mode, ai_enabled:false, auth_configured:false });
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const data: SessionInfo = { user: null, mode, ai_enabled, auth_configured };
    return json(data);
  }

  const { data: userData } = await supabase.auth.getUser();
  const authUser = userData?.user ?? null;

  if (!authUser) {
    const data: SessionInfo = { user: null, mode, ai_enabled, auth_configured };
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

  const data: SessionInfo = { user, mode, ai_enabled, auth_configured };
  return json(data);
});