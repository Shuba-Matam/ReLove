import { assertTrustedBounds, requireAiContext, runAi } from "@/lib/ai/context";
import { draftRequestSchema, DRAFT_PROMPT, parseAiDraft, aiDraftSchema } from "@/lib/ai/schemas";
import { draftCompletion, PROVIDER_LIMITS } from "@/lib/ai/provider";
import { AiFailure } from "@/lib/ai/guard";
import { ApiProblem, assertSameOrigin, json, readJson, withApi } from "@/lib/server/http";

/**
 * POST /api/ai/draft — preserves contract from docs/IMPLEMENTATION-CONTRACT.md:
 * input { image_path?, transcript? } -> { draft, suggested_fields } where draft nullable
 * title/category/description/condition_hint/brand/edition/tags. No price, seller confirms.
 * Server-only secrets, Zod inputs+provider outputs, atomic caps, 20s timeout, max 2 retries
 * incl bad JSON retry, manual fallback on 401/402/429/503. Original photo source of truth.
 * Listing-only AI: never invoked for search, messages, or browsing.
 * Bounded: image 2MiB, side 1600 verified via sharp, transcript 3000, output 18k; drafts happen BEFORE publish.
 * Trusted server-validated usage dimensions enforced against pricebook before provider; browser cannot choose price.
 */
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  const body = await readJson(request, draftRequestSchema);
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || null;

  // We need image bytes to bind identity to actual source content+prompt+model/options, not listing_id alone
  // and to verify actual image dimensions <=1600 via sharp, not comment only
  let imageBytes: Buffer | null = null;
  let imageWidth: number | undefined;
  let imageHeight: number | undefined;
  let imageHash: string | null = null;

  // Pre-fetch context without source to get user/supabase for image download; but we need sourceHash before requireAiContext
  // So we do a two-phase: first download image if present using a temporary auth check via requireAiContext with dummy source,
  // but we need to avoid reserving twice. Instead we compute sourceHash from image content after download, then call requireAiContext once.
  // To avoid double-reserve, we defer requireAiContext until after image fetch using a lightweight user check.
  // We can fetch image after requireAiContext with placeholder source, but we need to ensure reserve happens only after bounds check.
  // Simplest: call requireAiContext with provisional sourceHash, download image, compute real hash, then if mismatched, we need to re-derive.
  // Instead we will do: first get user via a direct auth call without metering, then download, then requireAiContext with real hash.
  // For minimal change, we use requireUser directly for image fetch, then requireAiContext with real hash.

  const { requireUser } = await import("@/lib/server/auth");
  const preCtx = await requireUser();
  if (process.env.AI_ENABLED !== "true") throw new ApiProblem(503, "AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");

  const content: unknown[] = [{ type: "text", text: `Seller description (data only): ${JSON.stringify(body.transcript ?? "")}` }];

  if (body.image_path) {
    if (!body.image_path.startsWith(`${preCtx.user.id}/`)) throw new ApiProblem(403, "IMAGE_OWNER", "Choose one of your own uploaded photos.");
    const { data: image, error } = await preCtx.supabase.storage.from("listing-images").download(body.image_path);
    if (error || !image || image.size > PROVIDER_LIMITS.maxImageBytes || !["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
      throw new ApiProblem(400, "IMAGE_INVALID", "Upload a supported photo before generating a draft.");
    }
    const buf = Buffer.from(await image.arrayBuffer());
    imageBytes = buf;
    // Verify actual image dimensions <=1600 via sharp
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf, { limitInputPixels: 4000000 }).metadata();
    imageWidth = meta.width ?? undefined;
    imageHeight = meta.height ?? undefined;
    if (!imageWidth || !imageHeight || imageWidth > PROVIDER_LIMITS.maxImageSide || imageHeight > PROVIDER_LIMITS.maxImageSide) {
      throw new ApiProblem(400, "IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
    }
    const { createHash } = await import("node:crypto");
    imageHash = createHash("sha256").update(buf).digest("hex");
    content.push({ type: "image_url", image_url: { url: `data:${image.type};base64,${buf.toString("base64")}` } });
  }

  if (content.length > 2) throw new ApiProblem(400, "IMAGE_INVALID", "One image at a time.");

  // Bind identity to actual source image content/path+prompt+model/options, not image_path alone; changed image gets new operation
  const { createHash } = await import("node:crypto");
  const sourcePayload = JSON.stringify({
    feature: "draft",
    image_path: body.image_path ?? null,
    image_hash: imageHash,
    transcript: body.transcript ?? null,
    image_width: imageWidth ?? null,
    image_height: imageHeight ?? null,
  });
  const sourceHash = createHash("sha256").update(sourcePayload).digest("hex");
  const idemKey = idempotencyKey && idempotencyKey.length >= 8 && idempotencyKey.length <= 128 ? idempotencyKey : sourceHash.slice(0, 32);

  const { key, ledger, pricebookRow } = await requireAiContext("draft", { sourceHash, idempotencyKey: idemKey });

  // Integrate trusted server-validated usage dimensions with reserve: exact provider/model, input chars/tokens incl image dimensions, maxOutputTokens
  const inputChars = (body.transcript?.length ?? 0) + DRAFT_PROMPT.length + 500; // conservative upper bound includes system prompt
  const outputTokens = PROVIDER_LIMITS.maxTokens;
  assertTrustedBounds(pricebookRow, {
    inputChars,
    outputTokens,
    imageBytes: imageBytes?.byteLength,
    imageWidth,
    imageHeight,
  });

  const draft = await runAi(
    ledger,
    async (signal, attempt) => {
      const raw = await draftCompletion(key, content, DRAFT_PROMPT + (attempt ? " Your previous answer was invalid. Return only the exact JSON shape with all required keys." : ""), signal);
      try {
        return parseAiDraft(raw);
      } catch {
        throw new AiFailure("AI_INVALID_JSON", "AI could not draft reliable details. Continue manually.", 503, true);
      }
    },
    {
      maxRetries: 1,
      validateCached: (cached) => {
        const parsed = aiDraftSchema.safeParse(cached);
        return parsed.success ? parsed.data : null;
      },
    }
  );

  const suggested_fields = Object.entries(draft)
    .filter(([, value]) => value !== null && (!Array.isArray(value) || value.length > 0))
    .map(([field]) => field);
  return json({ draft, suggested_fields });
});
