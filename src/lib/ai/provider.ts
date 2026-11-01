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

export async function basetenCompletion(key: string, content: unknown[], prompt: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://inference.baseten.co/v1/chat/completions", {
    method: "POST", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026", messages: [{ role: "system", content: prompt }, { role: "user", content }], max_tokens: 1200 }),
  });
  checkProviderResponse(response);
  const parsed = completion.safeParse(JSON.parse(await readLimitedText(response)));
  if (!parsed.success) throw new AiFailure("AI_RESPONSE", "AI returned an unusable draft. Continue manually.", 503, true);
  const choice = parsed.data.choices[0];
  if (choice.message.refusal || choice.finish_reason !== "stop" || !choice.message.content) throw new AiFailure("AI_RESPONSE", "AI could not produce a complete draft. Continue manually.", 503, true);
  return choice.message.content;
}
