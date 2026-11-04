import "server-only";
import { requireUser } from "@/lib/server/auth";
import { getSupabaseEnv } from "@/lib/server/env";
import { ApiProblem, json, withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session?.access_token || !session.expires_at || session.user.id !== user.id) {
    throw new ApiProblem(401, "reauth_required", "Please sign in again to receive live messages.");
  }
  const { url, publishableKey, hasConfig } = getSupabaseEnv();
  if (!hasConfig) throw new ApiProblem(503, "not_configured", "Live messaging is not configured.");
  return json({ url, publishableKey, accessToken: session.access_token, expiresAt: session.expires_at, userId: user.id });
});
