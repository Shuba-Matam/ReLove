import "server-only";
import sharp from "sharp";
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { z } from "zod";
import { AiFailure } from "./guard";
import { checkProviderResponse } from "./provider";
import { checkMask } from "./rules";

/**
 * SAM 3.1 contract verified 2026-11-02 via https://dev.meta.ai/docs/sam/client-libraries,
 * https://dev.meta.ai/docs/sam/segmenting:
 * - POST https://api.meta.ai/v1/responses, model "sam-3.1", stream:true,
 *   metadata.mask_encoding "one_bit", input_text (short noun phrase) + input_image
 *   (image_url as data URL or https). Stream is SSE with data: JSON events.
 * - Parser @meta-sam/parser is official; we use parseImageStream + decodeMaskToRaster.
 * - We never fetch arbitrary provider URLs; only the fixed Meta endpoint and we embed
 *   the original as base64 data URL. Provider payload URLs (if any) are ignored.
 * - The route requests 30 seconds, with a 20-second provider deadline. Actual latency
 *   remains unmeasured until provider smoke tests; no durable background queue exists.
 */
async function* responseEvents(response: Response) {
  if (!response.body) throw new AiFailure("MASK_EMPTY", "No cutout was returned.");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let total = 0;
  const eventSchema = z.object({ type: z.string() }).passthrough();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 6 * 1024 * 1024) throw new AiFailure("MASK_SIZE", "The cutout could not be processed.");
      buffer += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data && data !== "[DONE]") yield eventSchema.parse(JSON.parse(data));
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

function sanitizePrompt(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!cleaned) return "item";
  // SAM concept prompt must be short noun phrase; strip control chars and keep visible.
  const safe = cleaned.replace(/[\u0000-\u001f\u007f]/g, "");
  return safe.length ? safe : "item";
}

export async function makeCutout(input: { original: Buffer; prompt: string; key: string; signal: AbortSignal }): Promise<Buffer> {
  const metadata = await sharp(input.original, { limitInputPixels: 4000000 }).metadata();
  const width = metadata.width!; const height = metadata.height!;
  if (!width || !height || width > 1600 || height > 1600) throw new AiFailure("IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
  const safePrompt = sanitizePrompt(input.prompt);
  const response = await fetch("https://api.meta.ai/v1/responses", {
    method: "POST", signal: input.signal, redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "sam-3.1", stream: true, metadata: { mask_encoding: "one_bit" },
      input: [{ type: "message", role: "user", content: [
        { type: "input_text", text: safePrompt },
        { type: "input_image", image_url: `data:image/jpeg;base64,${input.original.toString("base64")}` },
      ] }],
    }),
  });
  checkProviderResponse(response);
  const result = await parseImageStream(responseEvents(response)).finalResult;
  if (result.outcome.status !== "completed" || result.diagnostics.some((item) => item.severity === "error")) throw new AiFailure("MASK_INVALID", "The item could not be cut out reliably. Your original photo is unchanged.");
  const masks = recordsOfKind(result.records, "mask");
  const candidates: { pixels: Buffer; area: number }[] = [];
  for (const record of masks.slice(0, 16)) {
    if (record.mask.width * record.mask.height > 4000000) continue;
    const { left, top, right, bottom } = record.bounds;
    if (![left, top, right, bottom].every(Number.isInteger) || left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) continue;
    const raster = decodeMaskToRaster(record.mask);
    const patch = await sharp(Buffer.from(raster.map((value) => value ? 255 : 0)), { raw: { width: record.mask.width, height: record.mask.height, channels: 1 } })
      .resize(right - left, bottom - top, { kernel: "nearest" }).raw().toBuffer();
    const full = Buffer.alloc(width * height);
    for (let row = 0; row < bottom - top; row++) patch.copy(full, (top + row) * width + left, row * (right - left), (row + 1) * (right - left));
    const check = checkMask(full, width, height);
    if (check.valid) candidates.push({ pixels: full, area: check.coverage });
  }
  if (candidates.length !== 1) throw new AiFailure("MASK_AMBIGUOUS", "The photo did not produce one clear cutout. Your original photo is unchanged.");
  const alpha = candidates[0].pixels;
  const rgba = await sharp(input.original).removeAlpha().joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return sharp(rgba).flatten({ background: "#f2f1ed" }).jpeg({ quality: 84 }).toBuffer();
}
