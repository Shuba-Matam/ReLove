import "server-only";
import { z } from "zod";
import { AiFailure } from "./guard";
import type { PricebookRow } from "./meter";

const completion = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1) });
const metaInputTokenCount = z.object({
  input_tokens: z.number().int().nonnegative().refine(Number.isSafeInteger),
});

const metaChatContent = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
    }).strict(),
  }).strict(),
])).min(1).max(2);

export async function readLimitedText(response: Response, limit = 32000): Promise<string> {
  if (!response.body) throw new AiFailure("AI_RESPONSE", "AI returned an empty response.", 503, true);
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let result = ""; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new AiFailure("AI_RESPONSE", "AI returned an unusable response.", 503, true);
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}

export function classifyProviderStatus(status: number): { code: string; message: string; retryable: boolean; http: number } {
  if (status === 401) return { code: "AI_CREDENTIALS", message: "AI credentials are invalid or expired. Continue manually.", retryable: false, http: 503 };
  if (status === 402) return { code: "AI_PAYMENT", message: "AI billing requires attention. Continue manually.", retryable: false, http: 503 };
  if (status === 403) return { code: "AI_FORBIDDEN", message: "AI access was denied. Continue manually.", retryable: false, http: 503 };
  if (status === 429) return { code: "AI_RATE_LIMIT", message: "AI is busy. Try again shortly or continue manually.", retryable: true, http: 503 };
  if (status >= 500) return { code: "AI_PROVIDER", message: "AI assistance is unavailable. Continue manually.", retryable: true, http: 503 };
  if (status === 413) return { code: "AI_SIZE", message: "The request was too large for AI processing.", retryable: false, http: 413 };
  if (status === 400) return { code: "AI_INVALID", message: "AI request was invalid. Continue manually.", retryable: false, http: 503 };
  return { code: "AI_PROVIDER", message: "AI assistance is unavailable. Continue manually.", retryable: false, http: 503 };
}

export function checkProviderResponse(response: Response) {
  if (!response.ok) {
    const info = classifyProviderStatus(response.status);
    throw new AiFailure(info.code, info.message, info.http, info.retryable);
  }
}

export const PROVIDER_LIMITS = {
  maxImageBytes: 2 * 1024 * 1024,
  maxAudioBytes: 3_000_000,
  maxOutputChars: 32000,
  maxDraftChars: 18000,
  maxTranscriptChars: 3000,
  maxTokens: 1200,
  maxImageSide: 1600,
} as const;

export const BASETEN_ENDPOINT = "https://inference.baseten.co/v1/chat/completions";
export const META_ENDPOINT = "https://api.meta.ai/v1/chat/completions";
export const META_INPUT_TOKENS_ENDPOINT = "https://api.meta.ai/v1/responses/input_tokens";
export const SUPPORTED_META_MODELS = ["muse-spark-1.3"] as const;
export const DEFAULT_BASETEN_MODEL = "meta-models/muse-spark-open-1026";

// Verified 2026-11-04 for Meta-hosted Muse Spark 1.3 Standard mode only:
// https://dev.meta.ai/docs/pricing-rate-limits
// Input $1.25/M tokens, output $4.25/M tokens. Integer units are 1/100 microUSD/token.
const META_MUSE_SPARK_1_3_STANDARD_INPUT_CENTI_MICRO_USD = 125n;
const META_MUSE_SPARK_1_3_STANDARD_OUTPUT_CENTI_MICRO_USD = 425n;

/**
 * Baseten contract verified 2026-11-02:
 * - Endpoint POST https://inference.baseten.co/v1/chat/completions with OpenAI-compatible body.
 * - Model slug `meta-models/muse-spark-open-1026` is the project default; official table lists
 *   `meta-models/muse-spark-open` — verify with the app's own Baseten account before enabling.
 * - Vision: content array with {type:"image_url", image_url:{url:"data:image/jpeg;base64,..."}} is allowed
 *   per OpenAPI (url may be base64 data URL). We use inline base64 to avoid public URL fetch.
 * - Muse Spark Open does NOT enforce structured outputs or JSON mode; docs note
 *   "except for Muse Spark Open" and "accepts json_object but doesn't constrain output".
 *   Do not set response_format; request plain text JSON and validate with Zod.
 * - We never fetch arbitrary provider URLs; only the two fixed endpoints above.
 *
 * Meta endpoint verified 2026-11-03 via official docs and approved 2026-11-03 for drafts:
 * - https://dev.meta.ai/docs/cookbook/quickstart-chat-completions and
 *   https://dev.meta.ai/docs/protocols/chat-completions document
 *   POST https://api.meta.ai/v1/chat/completions with model muse-spark-1.3 and vision
 *   (image_url data URL or https). This is Meta-hosted Muse Spark 1.3 standard (no
 *   Contributor variants/training), NOT Muse Spark Open (meta-models/muse-spark-open-1026
 *   via Baseten). Owner APPROVED muse-spark-1.3 standard for listing labels/descriptions
 *   using Meta app credits; implementation retains optional Baseten compatibility with no
 *   silent other-model fallback. All gates remain off (AI_ENABLED=false, DB disabled) until
 *   explicit activation; no paid tests. Any AI_DRAFT_PROVIDER=meta requires explicit opt-in
 *   and allowlisted model; invalid provider/model FAILS CLOSED.
 * - Voice: POST https://api.meta.ai/v1/asr/transcribe (muse-voice-transcribe-1.0) — verified via
 *   https://dev.meta.ai/docs/api-reference/voice/transcribe — uses META_API_KEY.
 * - SAM: POST https://api.meta.ai/v1/responses model sam-3.1 — verified via
 *   https://dev.meta.ai/docs/sam/client-libraries and /segmenting — uses META_API_KEY.
 * - Draft moderation via Meta is not implemented; when implemented it must follow the same
 *   explicit provider selector and fail-closed allowlist. No Contributor variants or training
 *   permission are requested or allowed.
 * - Coding-agent Baseten keys (T3) are separate from the app's BASETEN_API_KEY — do not conflate.
 */
export function getDraftProvider(): "baseten" | "meta" {
  const raw = process.env.AI_DRAFT_PROVIDER?.trim().toLowerCase();
  if (!raw) return "baseten";
  if (raw === "baseten") return "baseten";
  if (raw === "meta") return "meta";
  throw new AiFailure("AI_PROVIDER", "AI provider configuration is invalid. Continue manually.", 503, false);
}

export async function basetenCompletion(key: string, content: unknown[], prompt: string, signal: AbortSignal): Promise<string> {
  const model = process.env.BASETEN_MODEL?.trim() || DEFAULT_BASETEN_MODEL;
  const response = await fetch(BASETEN_ENDPOINT, {
    method: "POST", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: prompt }, { role: "user", content }], max_tokens: PROVIDER_LIMITS.maxTokens }),
  });
  checkProviderResponse(response);
  let json: unknown;
  try { json = JSON.parse(await readLimitedText(response, PROVIDER_LIMITS.maxOutputChars)); } catch { throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true); }
  const parsed = completion.safeParse(json);
  if (!parsed.success) throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true);
  const choice = parsed.data.choices[0];
  if (choice.message.refusal || choice.finish_reason !== "stop" || !choice.message.content) throw new AiFailure("AI_RESPONSE", "AI could not produce a complete draft. Continue manually.", 503, true);
  return choice.message.content;
}

function metaResponsesInput(content: unknown[], prompt: string) {
  const parsed = metaChatContent.safeParse(content);
  if (!parsed.success) throw new AiFailure("AI_PREFLIGHT", "AI cost checks could not validate this request. Continue manually.", 503, false);
  return [
    { role: "system", content: [{ type: "input_text", text: prompt }] },
    {
      role: "user",
      content: parsed.data.map((part) => part.type === "text"
        ? { type: "input_text" as const, text: part.text }
        : { type: "input_image" as const, image_url: part.image_url.url }),
    },
  ];
}

function metaWorstCaseCostMicroUsd(inputTokens: number, maxOutputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0) {
    throw new AiFailure("AI_PREFLIGHT", "AI cost checks returned an invalid result. Continue manually.", 503, false);
  }
  const centiMicroUsd = BigInt(inputTokens) * META_MUSE_SPARK_1_3_STANDARD_INPUT_CENTI_MICRO_USD
    + BigInt(maxOutputTokens) * META_MUSE_SPARK_1_3_STANDARD_OUTPUT_CENTI_MICRO_USD;
  const microUsd = (centiMicroUsd + 99n) / 100n;
  if (microUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AiFailure("AI_PREFLIGHT", "AI cost checks returned an invalid result. Continue manually.", 503, false);
  }
  return Number(microUsd);
}

async function metaCountInputTokens(key: string, model: string, input: ReturnType<typeof metaResponsesInput>, signal: AbortSignal): Promise<number> {
  let response: Response;
  try {
    response = await fetch(META_INPUT_TOKENS_ENDPOINT, {
      method: "POST", signal, cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
  } catch {
    if (signal.aborted) throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false);
    throw new AiFailure("AI_PREFLIGHT", "AI cost checks are unavailable. Continue manually.", 503, false);
  }
  if (!response.ok) {
    const info = classifyProviderStatus(response.status);
    throw new AiFailure(info.code, info.message, info.http, false);
  }
  let json: unknown;
  try {
    json = JSON.parse(await readLimitedText(response, 4096));
  } catch {
    throw new AiFailure("AI_PREFLIGHT", "AI cost checks returned an invalid result. Continue manually.", 503, false);
  }
  const parsed = metaInputTokenCount.safeParse(json);
  if (!parsed.success) throw new AiFailure("AI_PREFLIGHT", "AI cost checks returned an invalid result. Continue manually.", 503, false);
  return parsed.data.input_tokens;
}

export async function metaCompletion(key: string, content: unknown[], prompt: string, signal: AbortSignal, pricebook: PricebookRow): Promise<string> {
  const model = process.env.META_MODEL?.trim() || "";
  if (!(SUPPORTED_META_MODELS as unknown as string[]).includes(model)) {
    throw new AiFailure("AI_PROVIDER", "AI provider configuration is invalid. Continue manually.", 503, false);
  }
  if (pricebook.provider !== "meta" || pricebook.model !== model || !pricebook.enabled || !Number.isSafeInteger(pricebook.max_cost_micro_usd)) {
    throw new AiFailure("AI_PREFLIGHT", "AI cost checks are unavailable. Continue manually.", 503, false);
  }
  const maxOutputTokens = PROVIDER_LIMITS.maxTokens;
  const input = metaResponsesInput(content, prompt);
  const inputTokens = await metaCountInputTokens(key, model, input, signal);
  const worstCaseMicroUsd = metaWorstCaseCostMicroUsd(inputTokens, maxOutputTokens);
  if (worstCaseMicroUsd > pricebook.max_cost_micro_usd) {
    throw new AiFailure("AI_COST_LIMIT", "This AI request exceeds the configured cost limit. Continue manually.", 503, false);
  }
  const response = await fetch(META_ENDPOINT, {
    method: "POST", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: prompt }, { role: "user", content }], max_tokens: maxOutputTokens }),
  });
  checkProviderResponse(response);
  let json: unknown;
  try { json = JSON.parse(await readLimitedText(response, PROVIDER_LIMITS.maxOutputChars)); } catch { throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true); }
  const parsed = completion.safeParse(json);
  if (!parsed.success) throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true);
  const choice = parsed.data.choices[0];
  if (choice.message.refusal || choice.finish_reason !== "stop" || !choice.message.content) throw new AiFailure("AI_RESPONSE", "AI could not produce a complete draft. Continue manually.", 503, true);
  return choice.message.content;
}

export async function draftCompletion(key: string, content: unknown[], prompt: string, signal: AbortSignal, pricebook: PricebookRow): Promise<string> {
  const provider = getDraftProvider();
  if (provider === "meta") return metaCompletion(key, content, prompt, signal, pricebook);
  return basetenCompletion(key, content, prompt, signal);
}
