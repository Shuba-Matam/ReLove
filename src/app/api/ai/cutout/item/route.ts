import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertOwnerTestGate, assertTrustedBounds, requireAiContext } from "@/lib/ai/context";
import { makeBoxCutout, type NativeCutoutBox } from "@/lib/ai/cutout";
import { AiFailure } from "@/lib/ai/guard";
import { meterCompleteChecked } from "@/lib/ai/meter";
import { PROVIDER_LIMITS } from "@/lib/ai/provider";
import { isMultiCutoutEnabled } from "@/lib/server/env";
import { ApiProblem, assertSameOrigin, json, readJson, withApi } from "@/lib/server/http";
import { imagePathSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 30;

const SCALE = 1_000_000;
const normalizedBoxSchema = z.object({
  left: z.number().int().min(0).max(SCALE - 1),
  top: z.number().int().min(0).max(SCALE - 1),
  right: z.number().int().min(1).max(SCALE),
  bottom: z.number().int().min(1).max(SCALE),
}).strict().refine((box) => box.right > box.left && box.bottom > box.top, "Box must have positive width and height.");

const requestSchema = z.object({
  image_path: imagePathSchema,
  item_id: z.string().trim().regex(/^item-[a-z0-9-]{1,48}$/),
  box: normalizedBoxSchema,
}).strict();

const nativeBoxSchema = z.object({
  left: z.number().int().nonnegative(),
  top: z.number().int().nonnegative(),
  right: z.number().int().positive(),
  bottom: z.number().int().positive(),
}).strict();

const resultSchema = z.object({
  cutout_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/),
  cutout_url: z.string().min(10).max(1000),
  source_image_path: imagePathSchema,
  status: z.literal("done"),
  item_id: z.string().regex(/^item-[a-z0-9-]{1,48}$/),
  box: nativeBoxSchema,
}).strict();

type Stage = "source" | "reserve" | "provider" | "parse" | "mask" | "composition" | "storage" | "meter_complete" | "done";

function logStage(input: { stage: Stage; requestId: string; operationId?: string | null; code: string; elapsedMs: number; width?: number; height?: number; maskCount?: number; coverage?: number; components?: number }) {
  console.info("[multi-cutout]", JSON.stringify(input));
}

function toNativeBox(box: z.infer<typeof normalizedBoxSchema>, width: number, height: number): NativeCutoutBox {
  const left = Math.max(0, Math.min(width - 1, Math.floor((box.left * width) / SCALE)));
  const top = Math.max(0, Math.min(height - 1, Math.floor((box.top * height) / SCALE)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil((box.right * width) / SCALE)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil((box.bottom * height) / SCALE)));
  return { left, top, right, bottom };
}

function publicFailure(error: unknown): ApiProblem {
  if (error instanceof ApiProblem) return error;
  if (error instanceof AiFailure) return new ApiProblem(error.status, error.code, error.message);
  return new ApiProblem(503, "CUTOUT_FAILED", "This item could not be cut out reliably. Adjust the box and try again.");
}

export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  if (!isMultiCutoutEnabled()) throw new ApiProblem(404, "MULTI_CUTOUT_DISABLED", "Multiple-item cutouts are not available.");
  const requestId = randomUUID();
  const started = Date.now();
  const body = await readJson(request, requestSchema);

  const { requireUser } = await import("@/lib/server/auth");
  const preCtx = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can still publish items with the original photo.");
  assertOwnerTestGate(preCtx.user);
  if (!body.image_path.startsWith(`${preCtx.user.id}/`)) throw new ApiProblem(403, "IMAGE_OWNER", "Choose one of your own uploaded photos.");

  const { data: source, error: sourceError } = await preCtx.supabase.storage.from("listing-images").download(body.image_path);
  if (sourceError || !source || source.size > PROVIDER_LIMITS.maxImageBytes) {
    logStage({ stage: "source", requestId, code: "IMAGE_UNAVAILABLE", elapsedMs: Date.now() - started });
    throw new ApiProblem(400, "IMAGE_UNAVAILABLE", "The original photo could not be loaded.");
  }
  const original = Buffer.from(await source.arrayBuffer());
  const sharp = (await import("sharp")).default;
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(original, { limitInputPixels: 4000000 }).metadata();
  } catch {
    logStage({ stage: "source", requestId, code: "IMAGE_INVALID", elapsedMs: Date.now() - started });
    throw new ApiProblem(400, "IMAGE_INVALID", "The original photo is invalid or corrupted.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width > PROVIDER_LIMITS.maxImageSide || height > PROVIDER_LIMITS.maxImageSide) {
    logStage({ stage: "source", requestId, code: "IMAGE_SIZE", elapsedMs: Date.now() - started, width, height });
    throw new ApiProblem(400, "IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
  }
  const nativeBox = toNativeBox(body.box, width, height);
  const imageHash = createHash("sha256").update(original).digest("hex");
  const { getFeatureProviderModel } = await import("@/lib/server/env");
  const { provider, model } = getFeatureProviderModel("cutout");
  const sourceHash = createHash("sha256").update(JSON.stringify({
    feature: "cutout",
    flow: "multi-box-v1",
    image_path: body.image_path,
    image_hash: imageHash,
    box: nativeBox,
    provider,
    model,
  })).digest("hex");
  const idempotencyKey = sourceHash.slice(0, 32);

  const { supabase, user, key, ledger, pricebookRow, meteringClient } = await requireAiContext("cutout", { sourceHash, idempotencyKey, listingId: null });
  assertTrustedBounds(pricebookRow, { imageBytes: original.byteLength, imageWidth: width, imageHeight: height });

  let reservation: Awaited<ReturnType<typeof ledger.reserve>>;
  try {
    reservation = await ledger.reserve();
  } catch (error) {
    logStage({ stage: "reserve", requestId, code: error instanceof AiFailure ? error.code : "RESERVE_FAILED", elapsedMs: Date.now() - started, width, height });
    throw publicFailure(error);
  }

  if (!reservation.allowed) {
    if (reservation.disposition === "duplicate_done" && reservation.operationId) {
      const parsed = resultSchema.safeParse(reservation.cachedResult);
      if (!parsed.success || parsed.data.source_image_path !== body.image_path || JSON.stringify(parsed.data.box) !== JSON.stringify(nativeBox)
        || !parsed.data.cutout_path.startsWith(`${user.id}/`) || !parsed.data.cutout_url.endsWith(parsed.data.cutout_path)) {
        logStage({ stage: "reserve", requestId, operationId: reservation.operationId, code: "CACHE_INVALID", elapsedMs: Date.now() - started, width, height });
        throw new ApiProblem(503, "AI_UNAVAILABLE", "The saved cutout could not be verified. Generate it again later.");
      }
      const { data: operation, error: operationError } = await supabase.from("ai_operations").select("id,status,result").eq("id", reservation.operationId).eq("user_id", user.id).eq("feature", "cutout").eq("status", "done").maybeSingle();
      const stored = resultSchema.safeParse((operation as { result?: unknown } | null)?.result);
      if (operationError || !operation || (operation as { status?: string }).status !== "done" || !stored.success
        || stored.data.source_image_path !== parsed.data.source_image_path || stored.data.cutout_path !== parsed.data.cutout_path
        || JSON.stringify(stored.data.box) !== JSON.stringify(parsed.data.box)) {
        throw new ApiProblem(503, "AI_UNAVAILABLE", "The saved cutout could not be verified.");
      }
      const cachedName = parsed.data.cutout_path.split("/")[1];
      const { data: files, error: listError } = await supabase.storage.from("listing-images").list(user.id, { search: cachedName });
      if (listError || !(files ?? []).some((file) => file.name === cachedName)) throw new ApiProblem(503, "CUTOUT_MISSING", "The saved cutout is no longer available. Generate it again.");
      logStage({ stage: "done", requestId, operationId: reservation.operationId, code: "CACHE_HIT", elapsedMs: Date.now() - started, width, height });
      return json({ ...parsed.data, item_id: body.item_id, operation_id: reservation.operationId, duplicate: true, disposition: "duplicate_done" });
    }
    if (reservation.disposition === "duplicate_pending") throw new ApiProblem(409, "AI_PENDING", "This item is already being processed.");
    const reason = reservation.reason ?? "unknown";
    logStage({ stage: "reserve", requestId, operationId: reservation.operationId, code: reason, elapsedMs: Date.now() - started, width, height });
    if (["disabled", "feature_disabled", "budget_unconfigured", "unpriced_feature", "budget_exhausted"].includes(reason)) {
      throw new ApiProblem(503, "AI_DISABLED", "Cutout generation is unavailable or out of budget. Existing results are preserved.");
    }
    throw new ApiProblem(429, "AI_LIMIT", "The AI usage limit has been reached. Existing results are preserved.");
  }

  const attemptId = reservation.attemptId;
  const operationId = reservation.operationId;
  if (!attemptId || !operationId) throw new ApiProblem(503, "AI_UNAVAILABLE", "Cutout generation is unavailable.");

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const providerResult = await Promise.race([
      makeBoxCutout({ original, box: nativeBox, key, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AiFailure("AI_TIMEOUT", "The cutout took too long. Adjust the box or try again later.", 503, false));
        }, 20000);
      }),
    ]);
    logStage({ stage: "mask", requestId, operationId, code: "MASK_READY", elapsedMs: Date.now() - started, width, height, maskCount: providerResult.maskCount, coverage: providerResult.coverage, components: providerResult.components });

    const uploaded = `${user.id}/${randomUUID()}.jpg`;
    const publicUrl = supabase.storage.from("listing-images").getPublicUrl(uploaded).data.publicUrl;
    const { error: uploadError } = await supabase.storage.from("listing-images").upload(uploaded, providerResult.processed, { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      await ledger.complete(attemptId, false, Math.min(60000, Date.now() - started)).catch(() => undefined);
      logStage({ stage: "storage", requestId, operationId, code: "CUTOUT_SAVE", elapsedMs: Date.now() - started, width, height });
      throw new ApiProblem(503, "CUTOUT_SAVE", "The cutout could not be saved. Your original photo is unchanged.");
    }

    const result = resultSchema.parse({
      cutout_path: uploaded,
      cutout_url: publicUrl,
      source_image_path: body.image_path,
      status: "done",
      item_id: body.item_id,
      box: nativeBox,
    });
    try {
      await meterCompleteChecked({ client: meteringClient, userId: user.id, attemptId, ok: true, ms: Math.min(60000, Date.now() - started), result });
    } catch {
      await supabase.storage.from("listing-images").remove([uploaded]).catch(() => undefined);
      logStage({ stage: "meter_complete", requestId, operationId, code: "METER_COMPLETE_FAILED", elapsedMs: Date.now() - started, width, height });
      throw new ApiProblem(503, "AI_UNAVAILABLE", "The cutout could not be finalized safely. Generate it again later.");
    }
    logStage({ stage: "done", requestId, operationId, code: "DONE", elapsedMs: Date.now() - started, width, height, maskCount: providerResult.maskCount, coverage: providerResult.coverage, components: providerResult.components });
    return json({ ...result, operation_id: operationId });
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    if (error instanceof ApiProblem) throw error;
    await ledger.complete(attemptId, false, Math.min(60000, Date.now() - started)).catch(() => undefined);
    const failure = publicFailure(error);
    const stage: Stage = failure.code.startsWith("PROVIDER_") || failure.code.startsWith("AI_") ? "provider"
      : failure.code.startsWith("MASK_PARSE") || failure.code.startsWith("MASK_INCOMPLETE") ? "parse"
      : failure.code.startsWith("MASK_") ? "mask" : "composition";
    logStage({ stage, requestId, operationId, code: failure.code, elapsedMs: Date.now() - started, width, height });
    throw failure;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});
