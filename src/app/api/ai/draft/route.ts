import { requireAiContext, runAi } from "@/lib/ai/context";
import { draftRequestSchema, DRAFT_PROMPT, parseAiDraft } from "@/lib/ai/schemas";
import { basetenCompletion } from "@/lib/ai/provider";
import { AiFailure } from "@/lib/ai/guard";
import { ApiProblem, assertSameOrigin, json, readJson, withApi } from "@/lib/server/http";

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
    if (error || !image || image.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(image.type)) throw new ApiProblem(400, "IMAGE_INVALID", "Upload a supported photo before generating a draft.");
    content.push({ type: "image_url", image_url: { url: `data:${image.type};base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}` } });
  }
  const draft = await runAi(ledger, async (signal, attempt) => {
    const raw = await basetenCompletion(key, content, DRAFT_PROMPT + (attempt ? " Your previous answer was invalid. Return only the exact JSON shape with all required keys." : ""), signal);
    try { return parseAiDraft(raw); }
    catch { throw new AiFailure("AI_INVALID_JSON", "AI could not draft reliable details. Continue manually.", 503, true); }
  }, 1);
  const suggested_fields = Object.entries(draft).filter(([, value]) => value !== null && (!Array.isArray(value) || value.length > 0)).map(([field]) => field);
  return json({ draft, suggested_fields });
});
