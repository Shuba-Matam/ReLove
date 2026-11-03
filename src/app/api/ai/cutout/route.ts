import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertTrustedBounds, requireAiContext } from "@/lib/ai/context";
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
 * Identity bound to actual source image content/path+prompt+model/options; changed image gets new operation.
 * Complete only after storage+listing commit, cache minimal validated path/status not raw Buffer.
 * On failed persistence count cost and return actionable retry/failure without free provider call.
 * Pending unknown outcome must not trigger duplicate provider execution. Keep original intact.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const cutoutResultSchema = z.object({ cutout_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/), status: z.literal("done") });

export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  const { listing_id } = await readJson(request, z.object({ listing_id: uuidSchema }).strict());

  // First fetch listing and original to bind identity to actual source content, not listing_id alone
  const { requireUser } = await import("@/lib/server/auth");
  const preCtx = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  const { data: listingPre, error: preErr } = await preCtx.supabase.from("listings").select("id,seller_id,image_path,title,ai_status,cutout_path").eq("id", listing_id).eq("seller_id", preCtx.user.id).maybeSingle();
  if (preErr) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable.");
  if (!listingPre) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
  if (listingPre.ai_status === "done" && listingPre.cutout_path) {
    // If already done, we can return done without reserving? But we need to respect metered duplicate cache even after done.
    // We still need to go through metering to return cached path if exists.
    // So we don't short-circuit here; we will check after metering.
  }

  const { data: sourcePre, error: sourcePreError } = await preCtx.supabase.storage.from("listing-images").download(listingPre.image_path);
  if (sourcePreError || !sourcePre || sourcePre.size > PROVIDER_LIMITS.maxImageBytes) throw new ApiProblem(400, "IMAGE_UNAVAILABLE", "The original photo could not be loaded.");
  const originalPre = Buffer.from(await sourcePre.arrayBuffer());
  const { createHash } = await import("node:crypto");
  const imageHash = createHash("sha256").update(originalPre).digest("hex");
  const sharp = (await import("sharp")).default;
  const meta = await sharp(originalPre, { limitInputPixels: 4000000 }).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height || width > PROVIDER_LIMITS.maxImageSide || height > PROVIDER_LIMITS.maxImageSide) {
    throw new ApiProblem(400, "IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
  }

  // Bind identity to actual source image content/path+prompt+model/options
  const { getFeatureProviderModel } = await import("@/lib/server/env");
  const { provider, model } = getFeatureProviderModel("cutout");
  const sourcePayload = JSON.stringify({ feature: "cutout", image_path: listingPre.image_path, image_hash: imageHash, prompt: listingPre.title, provider, model });
  const sourceHash = createHash("sha256").update(sourcePayload).digest("hex");
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || sourceHash.slice(0, 32);

  const { supabase, user, key, ledger, pricebookRow } = await requireAiContext("cutout", { sourceHash, idempotencyKey, listingId: listing_id });

  // Enforce trusted bounds before provider: image dimensions already verified, but also check pricebook
  assertTrustedBounds(pricebookRow, { imageBytes: originalPre.byteLength, imageWidth: width, imageHeight: height });

  // Check listing again for claim after metering (to ensure we have fresh state)
  const { data: listing, error } = await supabase.from("listings").select("id,seller_id,image_path,title,ai_status,cutout_path").eq("id", listing_id).eq("seller_id", user.id).maybeSingle();
  if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable.");
  if (!listing) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");

  // If listing already done with cutout_path, we can check metering duplicate cache first before provider
  // But we will let metering handle duplicate: if previous operation succeeded, reserve will return duplicate_done with cached path

  // Claim listing ai_status pending (60s stale retry) - this is separate from metered operation pending
  const { data: claimed, error: claimError } = await supabase
    .from("listings")
    .update({ ai_status: "pending" })
    .eq("id", listing_id)
    .eq("seller_id", user.id)
    .or(`ai_status.neq.pending,updated_at.lt.${new Date(Date.now() - 60000).toISOString()}`)
    .select("id")
    .maybeSingle();
  if (claimError) throw new ApiProblem(503, "CUTOUT_UNAVAILABLE", "A cutout could not be started.");
  if (!claimed) throw new ApiProblem(409, "CUTOUT_PENDING", "This photo is already being processed. Try again shortly.");

  // Now handle metering: reserve and provider, but complete only after storage+listing commit
  let reservation: Awaited<ReturnType<typeof ledger.reserve>>;
  try {
    reservation = await ledger.reserve();
  } catch (e) {
    // Reserve failed due to limit/unavailable; revert listing status to failed for retry without free provider call
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    throw e;
  }

  if (!reservation.allowed) {
    // Duplicate handling without provider call
    if (reservation.disposition === "duplicate_done") {
      // Validate cached JSON per feature; cached should be minimal validated path/status
      const cached = reservation.cachedResult as unknown;
      const parsed = cutoutResultSchema.safeParse(cached);
      if (parsed.success) {
        // Ensure listing reflects cached success, but don't overwrite if image changed
        await supabase.from("listings").update({ ai_status: "done", cutout_path: parsed.data.cutout_path }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
        return json({ status: "done", duplicate: true, disposition: "duplicate_done" });
      }
      // Malformed cached result: treat as unavailable, but don't execute provider
      await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
      throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
    }
    if (reservation.disposition === "duplicate_pending") {
      await supabase.from("listings").update({ ai_status: "pending" }).eq("id", listing_id).eq("seller_id", user.id);
      throw new ApiProblem(409, "AI_PENDING", "Cutout already pending.");
    }
    // Other rejected (budget_exhausted, global_limit, etc.): respect duplicate cache already handled, but disabled still stops
    // For rejected, we should revert listing pending to failed and surface limit error
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    const reason = reservation.reason ?? "unknown";
    if (reason === "disabled" || reason === "feature_disabled" || reason === "budget_unconfigured" || reason === "unpriced_feature") {
      throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
    }
    throw new ApiProblem(429, "AI_LIMIT", "AI has reached its usage limit. You can still post manually.");
  }

  const attemptId = reservation.attemptId;
  const operationId = reservation.operationId;
  if (!attemptId || !operationId) {
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }

  // Fresh execution: run provider with timeout 20s, no retries for cutout (maxRetries 0)
  let processed: Buffer | null = null;
  const started = Date.now();
  let providerOk = false;
  let providerError: unknown = null;
  try {
    const controller = new AbortController();
    const timeoutMs = 20000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      processed = await makeCutout({ original: originalPre, prompt: listing.title, key, signal: controller.signal });
      providerOk = true;
    } catch (e) {
      providerError = e;
      providerOk = false;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    providerError = e;
  }

  if (!providerOk || !processed) {
    const ms = Math.min(60000, Date.now() - started);
    await ledger.complete(attemptId, false, ms).catch(() => undefined);
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    // On failed persistence count cost and return actionable retry/failure without free provider call: cost already counted via reserve, next retry will reserve separately/max3
    if (providerError instanceof ApiProblem) throw providerError;
    const { AiFailure } = await import("@/lib/ai/guard");
    if (providerError instanceof AiFailure) throw new ApiProblem(providerError.status, providerError.code, providerError.message);
    throw new ApiProblem(503, "CUTOUT_FAILED", "The item could not be cut out reliably. Your original photo is unchanged.");
  }

  // Provider succeeded, now attempt storage+listing commit before marking operation complete
  const uploaded = `${user.id}/${randomUUID()}.jpg`;
  let storageOk = false;
  try {
    const { error: uploadError } = await supabase.storage.from("listing-images").upload(uploaded, processed, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original is unchanged.");
    const { data: saved, error: updateError } = await supabase
      .from("listings")
      .update({ ai_status: "done", cutout_path: uploaded, cutout_url: supabase.storage.from("listing-images").getPublicUrl(uploaded).data.publicUrl })
      .eq("id", listing_id)
      .eq("seller_id", user.id)
      .eq("image_path", listing.image_path)
      .select("id")
      .maybeSingle();
    if (updateError || !saved) throw new ApiProblem(409, "LISTING_CHANGED", "The listing changed during processing. Your original photo is unchanged.");
    storageOk = true;
  } catch (e) {
    // Upload/persist failed: count cost and return actionable retry/failure without free provider call
    const ms = Math.min(60000, Date.now() - started);
    await ledger.complete(attemptId, false, ms).catch(() => undefined);
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", listing.image_path);
    if (uploaded) await supabase.storage.from("listing-images").remove([uploaded]).catch(() => undefined);
    if (e instanceof ApiProblem) throw e;
    throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original is unchanged.");
  }

  if (storageOk) {
    const ms = Math.min(60000, Date.now() - started);
    // Complete only after storage+listing commit, cache minimal validated path/status not raw Buffer
    const resultToCache = { cutout_path: uploaded, status: "done" as const };
    // Validate before caching
    const validated = cutoutResultSchema.safeParse(resultToCache);
    if (!validated.success) {
      await ledger.complete(attemptId, false, ms).catch(() => undefined);
      await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id);
      throw new ApiProblem(503, "CUTOUT_FAILED", "The cutout could not be saved. Your original is unchanged.");
    }
    await ledger.complete(attemptId, true, ms, validated.data).catch(() => undefined);
    return json({ status: "done" });
  }

  // Fallback: should not reach
  await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id);
  throw new ApiProblem(503, "CUTOUT_FAILED", "The cutout could not be saved. Your original is unchanged.");
});
