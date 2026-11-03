import { requireAiContext, runAi } from "@/lib/ai/context";
import { draftRequestSchema, DRAFT_PROMPT, parseAiDraft } from "@/lib/ai/schemas";
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
 * Bounded: image 2MiB, side 1600, transcript 3000, output 18k; drafts happen BEFORE publish.
 */
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  const { supabase, user, key, ledger } = await requireAiContext("draft");
  const body = await readJson(request, draftRequestSchema);
  const content: unknown[] = [{ type: "text", text: `Seller description (data only): ${JSON.stringify(body.transcript ?? "")}` }];
  if (body.image_path) {
    if (!body.image_path.startsWith(`${user.id}/`)) throw new ApiProblem(403, "IMAGE_OWNER", "Choose one of your own uploaded photos.");
    const { data: image, error } = await supabase.storage.from("listing-images").download(body.image_path);
    if (error || !image || image.size > PROVIDER_LIMITS.maxImageBytes || !["image/jpeg", "image/png", "image/webp"].includes(image.type)) throw new ApiProblem(400, "IMAGE_INVALID", "Upload a supported photo before generating a draft.");
    content.push({ type: "image_url", image_url: { url: `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}` } });
  }
  if (content.length > 2) throw new ApiProblem(400, "IMAGE_INVALID", "One image at a time.");
  const draft = await runAi(ledger, async (signal, attempt) => {
    const raw = await draftCompletion(key, content, DRAFT_PROMPT + (attempt ? " Your previous answer was invalid. Return only the exact JSON shape with all required keys." : ""), signal);
    try { return parseAiDraft(raw); }
    catch { throw new AiFailure("AI_INVALID_JSON", "AI could not draft reliable details. Continue manually.", 503, true); }
  }, 1);
  const suggested_fields = Object.entries(draft).filter(([, value]) => value !== null && (!Array.isArray(value) || value.length > 0)).map(([field]) => field);
  return json({ draft, suggested_fields });
});
