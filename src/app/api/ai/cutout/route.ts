import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAiContext, runAi } from "@/lib/ai/context";
import { makeCutout } from "@/lib/ai/cutout";
import { PROVIDER_LIMITS } from "@/lib/ai/provider";
import { ApiProblem, assertSameOrigin, json, readJson, withApi } from "@/lib/server/http";
import { uuidSchema } from "@/lib/validation";

/**
 * POST /api/ai/cutout — optional, off until provider ready. Owner-only SAM cutout.
 * Preserves original until derived JPEG is valid; correct mask size/fragmentation;
 * no blind trust of provider URLs; atomic claim with 60s stale retry; Vercel bounded
 * request (maxDuration 30, timeout 20s, no background job — see docs/PHASE-2-AI.md audit).
 * Keeps IMPLEMENTATION-CONTRACT: { listing_id } -> { status }.
 */
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  const { listing_id } = await readJson(request, z.object({ listing_id: uuidSchema }).strict());
  const { createHash } = await import("node:crypto");
  const sourceHash = createHash("sha256").update(JSON.stringify({ feature: "cutout", listing_id })).digest("hex");
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || sourceHash.slice(0, 32);
  const { supabase, user, key, ledger } = await requireAiContext("cutout", { sourceHash, idempotencyKey, listingId: listing_id });
  const { data: listing, error } = await supabase.from("listings").select("id,seller_id,image_path,title,ai_status,cutout_path").eq("id", listing_id).eq("seller_id", user.id).maybeSingle();
  if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable.");
  if (!listing) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
  if (listing.ai_status === "done") return json({ status: "done" });
  // A single owner request claims the job; stale claims can be retried after a minute.
  const { data: claimed, error: claimError } = await supabase.from("listings").update({ ai_status: "pending" }).eq("id", listing_id).eq("seller_id", user.id)
    .or(`ai_status.neq.pending,updated_at.lt.${new Date(Date.now() - 60000).toISOString()}`).select("id").maybeSingle();
  if (claimError) throw new ApiProblem(503, "CUTOUT_UNAVAILABLE", "A cutout could not be started.");
  if (!claimed) throw new ApiProblem(409, "CUTOUT_PENDING", "This photo is already being processed. Try again shortly.");
  let uploaded: string | null = null;
  try {
    const { data: source, error: sourceError } = await supabase.storage.from("listing-images").download(listing.image_path);
    if (sourceError || !source || source.size > PROVIDER_LIMITS.maxImageBytes) throw new ApiProblem(400, "IMAGE_UNAVAILABLE", "The original photo could not be loaded.");
    const original = Buffer.from(await source.arrayBuffer());
    let processed: Buffer;
    try {
      processed = await runAi(ledger, (signal) => makeCutout({ original, prompt: listing.title, key, signal }), 0);
    } catch (e) {
      const { AiFailure } = await import("@/lib/ai/guard");
      if (e instanceof AiFailure && e.code === "AI_DUPLICATE_DONE") return json({ status: "done", duplicate: true, disposition: "duplicate_done" });
      if (e instanceof AiFailure && e.code === "AI_DUPLICATE_PENDING") throw new ApiProblem(409, "AI_PENDING", "Cutout already pending.");
      throw e;
    }
    uploaded = `${user.id}/${randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from("listing-images").upload(uploaded, processed, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original is unchanged.");
    const { data: saved, error: updateError } = await supabase.from("listings").update({ ai_status: "done", cutout_path: uploaded, cutout_url: supabase.storage.from("listing-images").getPublicUrl(uploaded).data.publicUrl })
      .eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path).select("id").maybeSingle();
    if (updateError || !saved) throw new ApiProblem(409, "LISTING_CHANGED", "The listing changed during processing. Your original photo is unchanged.");
    return json({ status: "done" });
  } catch (failure) {
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    if (uploaded) await supabase.storage.from("listing-images").remove([uploaded]);
    throw failure;
  }
});
