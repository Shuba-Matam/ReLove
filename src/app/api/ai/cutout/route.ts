import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertTrustedBounds, assertOwnerTestGate, requireAiContext } from "@/lib/ai/context";
import { makeCutout } from "@/lib/ai/cutout";
import { PROVIDER_LIMITS } from "@/lib/ai/provider";
import { ApiProblem, assertSameOrigin, json, readJson, withApi } from "@/lib/server/http";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

const cutoutResultSchema = z.object({
  cutout_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/),
  cutout_url: z.string().min(10).max(1000),
  status: z.literal("done"),
});

export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  const { listing_id } = await readJson(request, z.object({ listing_id: uuidSchema }).strict());

  const { requireUser } = await import("@/lib/server/auth");
  const preCtx = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  assertOwnerTestGate(preCtx.user);
  const { data: listingPre, error: preErr } = await preCtx.supabase
    .from("listings")
    .select("id,seller_id,image_path,title,ai_status,cutout_path,cutout_url")
    .eq("id", listing_id)
    .eq("seller_id", preCtx.user.id)
    .maybeSingle();
  if (preErr) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable.");
  if (!listingPre) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");

  const snapshotImagePath = (listingPre as { image_path: string }).image_path;
  const snapshotTitle = (listingPre as { title: string }).title;

  if ((listingPre as { ai_status?: string }).ai_status === "done" && (listingPre as { cutout_path?: string | null }).cutout_path) {
    const cp = (listingPre as { cutout_path: string }).cutout_path;
    const cu = (listingPre as { cutout_url?: string | null }).cutout_url;
    if (cp && cp.startsWith(`${preCtx.user.id}/`) && cu && cu.endsWith(cp)) {
      return json({ status: "done" });
    }
  }

  const { data: sourcePre, error: sourcePreError } = await preCtx.supabase.storage.from("listing-images").download(snapshotImagePath);
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

  const { getFeatureProviderModel } = await import("@/lib/server/env");
  const { provider, model } = getFeatureProviderModel("cutout");
  const sourcePayload = JSON.stringify({ feature: "cutout", image_path: snapshotImagePath, image_hash: imageHash, prompt: snapshotTitle, provider, model });
  const sourceHash = createHash("sha256").update(sourcePayload).digest("hex");
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || sourceHash.slice(0, 32);

  const { supabase, user, key, ledger, pricebookRow } = await requireAiContext("cutout", { sourceHash, idempotencyKey, listingId: listing_id });

  assertTrustedBounds(pricebookRow, { imageBytes: originalPre.byteLength, imageWidth: width, imageHeight: height });

  const { data: listing, error } = await supabase.from("listings").select("id,seller_id,image_path,title,ai_status,cutout_path,cutout_url").eq("id", listing_id).eq("seller_id", user.id).maybeSingle();
  if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable.");
  if (!listing) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
  const currentImagePath = (listing as { image_path: string }).image_path;
  const currentTitle = (listing as { title: string }).title;
  if (currentImagePath !== snapshotImagePath || currentTitle !== snapshotTitle) {
    throw new ApiProblem(409, "LISTING_CHANGED", "The listing changed during processing. Your original photo is unchanged.");
  }

  const { data: claimed, error: claimError } = await supabase
    .from("listings")
    .update({ ai_status: "pending" })
    .eq("id", listing_id)
    .eq("seller_id", user.id)
    .eq("image_path", snapshotImagePath)
    .or(`ai_status.neq.pending,updated_at.lt.${new Date(Date.now() - 60000).toISOString()}`)
    .select("id")
    .maybeSingle();
  if (claimError) throw new ApiProblem(503, "CUTOUT_UNAVAILABLE", "A cutout could not be started.");
  if (!claimed) throw new ApiProblem(409, "CUTOUT_PENDING", "This photo is already being processed. Try again shortly.");

  let reservation: Awaited<ReturnType<typeof ledger.reserve>>;
  try {
    reservation = await ledger.reserve();
  } catch (e) {
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
    throw e;
  }

  if (!reservation.allowed) {
    if (reservation.disposition === "duplicate_done") {
      const cached = reservation.cachedResult as unknown;
      const parsed = cutoutResultSchema.safeParse(cached);
      if (parsed.success) {
        if (!parsed.data.cutout_path.startsWith(`${user.id}/`) || !parsed.data.cutout_url.endsWith(parsed.data.cutout_path)) {
          await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
          throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
        }
        const { data: restored, error: restoreErr } = await supabase
          .from("listings")
          .update({ ai_status: "done", cutout_path: parsed.data.cutout_path, cutout_url: parsed.data.cutout_url })
          .eq("id", listing_id)
          .eq("seller_id", user.id)
          .eq("image_path", snapshotImagePath)
          .select("id")
          .maybeSingle();
        if (restoreErr || !restored) {
          throw new ApiProblem(409, "LISTING_CHANGED", "The listing changed during processing. Your original photo is unchanged.");
        }
        return json({ status: "done", duplicate: true, disposition: "duplicate_done" });
      }
      await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
      throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
    }
    if (reservation.disposition === "duplicate_pending") {
      await supabase.from("listings").update({ ai_status: "pending" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
      throw new ApiProblem(409, "AI_PENDING", "Cutout already pending.");
    }
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
    const reason = reservation.reason ?? "unknown";
    if (reason === "disabled" || reason === "feature_disabled" || reason === "budget_unconfigured" || reason === "unpriced_feature") {
      throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
    }
    throw new ApiProblem(429, "AI_LIMIT", "AI has reached its usage limit. You can still post manually.");
  }

  const attemptId = reservation.attemptId;
  const operationId = reservation.operationId;
  if (!attemptId || !operationId) {
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
    throw new ApiProblem(503, "AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.");
  }

  let processed: Buffer | null = null;
  const started = Date.now();
  let providerOk = false;
  let providerError: unknown = null;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = 20000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ApiProblem(503, "AI_TIMEOUT", "AI took too long. Continue with the manual form."));
    }, timeoutMs);
  });
  try {
    processed = await Promise.race([makeCutout({ original: originalPre, prompt: snapshotTitle, key, signal: controller.signal }), timeoutPromise]);
    providerOk = true;
  } catch (e) {
    providerError = e;
    providerOk = false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!providerOk || !processed) {
    const ms = Math.min(60000, Date.now() - started);
    await ledger.complete(attemptId, false, ms).catch(() => undefined);
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
    if (providerError instanceof ApiProblem) throw providerError;
    const { AiFailure } = await import("@/lib/ai/guard");
    if (providerError instanceof AiFailure) throw new ApiProblem(providerError.status, providerError.code, providerError.message);
    throw new ApiProblem(503, "CUTOUT_FAILED", "The item could not be cut out reliably. Your original photo is unchanged.");
  }

  const uploaded = `${user.id}/${randomUUID()}.jpg`;
  const publicUrl = supabase.storage.from("listing-images").getPublicUrl(uploaded).data.publicUrl;
  let storageOk = false;
  try {
    const { error: uploadError } = await supabase.storage.from("listing-images").upload(uploaded, processed, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original is unchanged.");
    const { data: saved, error: updateError } = await supabase
      .from("listings")
      .update({ ai_status: "done", cutout_path: uploaded, cutout_url: publicUrl })
      .eq("id", listing_id)
      .eq("seller_id", user.id)
      .eq("image_path", snapshotImagePath)
      .select("id")
      .maybeSingle();
    if (updateError || !saved) throw new ApiProblem(409, "LISTING_CHANGED", "The listing changed during processing. Your original photo is unchanged.");
    storageOk = true;
  } catch (e) {
    const ms = Math.min(60000, Date.now() - started);
    await ledger.complete(attemptId, false, ms).catch(() => undefined);
    await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
    if (uploaded) await supabase.storage.from("listing-images").remove([uploaded]).catch(() => undefined);
    if (e instanceof ApiProblem) throw e;
    throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original is unchanged.");
  }

  if (storageOk) {
    const ms = Math.min(60000, Date.now() - started);
    const resultToCache = { cutout_path: uploaded, cutout_url: publicUrl, status: "done" as const };
    const validated = cutoutResultSchema.safeParse(resultToCache);
    if (!validated.success) {
      await ledger.complete(attemptId, false, ms).catch(() => undefined);
      await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
      throw new ApiProblem(503, "CUTOUT_FAILED", "The cutout could not be saved. Your original is unchanged.");
    }
    await ledger.complete(attemptId, true, ms, validated.data).catch(() => undefined);
    return json({ status: "done" });
  }

  await supabase.from("listings").update({ ai_status: "failed" }).eq("id", listing_id).eq("seller_id", user.id).eq("image_path", snapshotImagePath);
  throw new ApiProblem(503, "CUTOUT_FAILED", "The cutout could not be saved. Your original is unchanged.");
});
