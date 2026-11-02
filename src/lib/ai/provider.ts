import "server-only";
import { z } from "zod";
import { AiFailure } from "./guard";

const completion = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1) });

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

export function checkProviderResponse(response: Response) {
  if (!response.ok) throw new AiFailure("AI_PROVIDER", "AI assistance is unavailable. Continue manually.", 503, response.status === 429 || response.status >= 500);
}

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
 * - We never fetch arbitrary provider URLs; only the fixed Baseten/Meta endpoints.
 */
export async function basetenCompletion(key: string, content: unknown[], prompt: string, signal: AbortSignal): Promise<string> {
  const model = process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open-1026";
  const response = await fetch("https://inference.baseten.co/v1/chat/completions", {
    method: "POST", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: prompt }, { role: "user", content }], max_tokens: 1200 }),
  });
  checkProviderResponse(response);
  let json: unknown;
  try { json = JSON.parse(await readLimitedText(response)); } catch { throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true); }
  const parsed = completion.safeParse(json);
  if (!parsed.success) throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true);
  const choice = parsed.data.choices[0];
  if (choice.message.refusal || choice.finish_reason !== "stop" || !choice.message.content) throw new AiFailure("AI_RESPONSE", "AI could not produce a complete draft. Continue manually.", 503, true);
  return choice.message.content;
}
