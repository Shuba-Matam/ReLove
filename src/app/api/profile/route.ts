import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { profileSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const PATCH = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only. Profile updates are disabled.");
  }

  const { supabase, user } = await requireUser();

  const input = await readJson(request, profileSchema);

  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: input.display_name,
      hostel_block: input.hostel_block,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .select("id, display_name, avatar_url, hostel_block, created_at")
    .single();

  if (error) {
    console.error("[profile PATCH] db error:", error);
    throw new ApiProblem(500, "db_error", "Failed to update profile.");
  }

  if (!data) throw new ApiProblem(404, "not_found", "Profile not found.");

  return json(data);
});

// Optional GET for current profile
export const GET = withApi(async () => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only.");
  }
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, hostel_block, created_at")
    .eq("id", user.id)
    .single();
  if (error) {
    if ((error as { code?: string }).code === "PGRST116") throw new ApiProblem(404, "not_found", "Profile not found.");
    console.error("[profile GET] db error:", error);
    throw new ApiProblem(500, "db_error", "Failed to load profile.");
  }
  return json(data);
});
