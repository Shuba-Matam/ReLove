import "server-only";
import { createSupabaseServerClient } from "./supabase";
import { ApiProblem } from "./http";
import { getAppMode } from "./env";

export async function requireUser(): Promise<{
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  user: { id: string; email?: string | null };
}> {
  const mode = getAppMode();
  if (mode === "demo" || mode === "setup") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only. Mutations are disabled.");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    throw new ApiProblem(503, "not_configured", "Service not configured.");
  }

  // Verified auth: getUser validates JWT via Supabase Auth server
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    // Fallback maybe try getClaims for newer SSR? but getUser is sufficient
    throw new ApiProblem(401, "unauthorized", "Authentication required.");
  }

  const user = data.user;

  // Optional additional verification via getClaims if available
  // We ignore errors here; getUser already verified
  return { supabase, user: { id: user.id, email: user.email } };
}

// Optional helper to get session user if present, without throwing
export async function getOptionalUser(): Promise<{ supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; user: { id: string } | null }> {
  if (getAppMode() !== "live") return { supabase: null, user: null };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, user: null };
  const { data } = await supabase.auth.getUser();
  if (!data?.user) return { supabase, user: null };
  return { supabase, user: { id: data.user.id } };
}
