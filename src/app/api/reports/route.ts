import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { reportSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode reporting is disabled.");
  }

  const { supabase, user } = await requireUser();
  const input = await readJson(request, reportSchema);

  // Verify listing exists
  const { data: listing, error: listingErr } = await supabase.from("listings").select("id").eq("id", input.listing_id).single();
  if (listingErr) {
    if ((listingErr as { code?: string }).code === "PGRST116" || listingErr.message?.includes("No rows")) {
      throw new ApiProblem(404, "not_found", "Listing not found.");
    }
    console.error("[reports POST] listing check error:", listingErr);
    throw new ApiProblem(500, "db_error", "Failed to verify listing.");
  }
  if (!listing) throw new ApiProblem(404, "not_found", "Listing not found.");

  const { error: insertErr } = await supabase.from("reports").insert({
    listing_id: input.listing_id,
    reporter_id: user.id,
    reason: input.reason,
    details: input.details ?? "",
  });

  if (insertErr) {
    console.error("[reports POST] insert error:", insertErr);
    throw new ApiProblem(500, "db_error", "Failed to submit report.");
  }

  return json({ submitted: true }, 201);
});
