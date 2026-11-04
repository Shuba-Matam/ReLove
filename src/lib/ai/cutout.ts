import "server-only";
import sharp from "sharp";
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind, type SegmentationMaskRecord } from "@meta-sam/parser";
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

export type NativeCutoutBox = { left: number; top: number; right: number; bottom: number };

export function selectBoxMaskRecord(masks: readonly SegmentationMaskRecord[], objectId = "1"): SegmentationMaskRecord {
  const matching = masks.filter((record) => record.objectId === objectId && (record.frame?.frameIndex ?? 0) === 0);
  if (masks.some((record) => record.objectId !== objectId) || matching.length > 1) {
    throw new AiFailure("MASK_AMBIGUOUS", "The marked area returned more than one object. Tighten the box and try again.");
  }
  if (matching.length === 0) throw new AiFailure("MASK_EMPTY", "No clear item was found inside that box. Adjust it and try again.");
  return matching[0];
}

async function maskRecordToCanvas(record: SegmentationMaskRecord, width: number, height: number): Promise<{ pixels: Buffer; coverage: number; components: number }> {
  if (record.mask.width * record.mask.height > 4000000) throw new AiFailure("MASK_SIZE", "The cutout mask was too large to process safely.");
  const { left, top, right, bottom } = record.bounds;
  if (![left, top, right, bottom].every(Number.isInteger) || left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) {
    throw new AiFailure("MASK_GEOMETRY", "The cutout mask did not match the photo bounds.");
  }
  const raster = decodeMaskToRaster(record.mask);
  if (raster.length !== record.mask.width * record.mask.height) throw new AiFailure("MASK_INVALID", "The cutout mask was malformed.");
  const patchWidth = right - left;
  const patchHeight = bottom - top;
  const grayscale = Buffer.from(raster.map((value) => value ? 255 : 0));
  if (grayscale.length !== record.mask.width * record.mask.height) throw new AiFailure("MASK_INVALID", "The cutout mask was malformed.");
  const { data: patch, info: patchInfo } = await sharp(grayscale, {
    raw: { width: record.mask.width, height: record.mask.height, channels: 1 },
  })
    .resize(patchWidth, patchHeight, { kernel: "nearest" })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (patchInfo.channels !== 1 || patchInfo.width !== patchWidth || patchInfo.height !== patchHeight || patch.length !== patchWidth * patchHeight) {
    throw new AiFailure("MASK_GEOMETRY", "The cutout mask did not match the photo.");
  }
  const full = Buffer.alloc(width * height);
  for (let row = 0; row < patchHeight; row++) {
    patch.copy(full, (top + row) * width + left, row * patchWidth, (row + 1) * patchWidth);
  }
  if (full.length !== width * height) throw new AiFailure("MASK_GEOMETRY", "The cutout mask could not be placed safely.");
  const check = checkMask(full, width, height);
  if (!check.valid) throw new AiFailure(`MASK_QUALITY_${check.reason.toUpperCase()}`, "The marked item did not produce a reliable cutout. Adjust the box and try again.");
  return { pixels: full, coverage: check.coverage, components: check.components };
}

async function requestSam(original: Buffer, inputText: string, key: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch("https://api.meta.ai/v1/responses", {
      method: "POST", signal, redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: "sam-3.1", stream: true, metadata: { mask_encoding: "one_bit" },
        input: [{ type: "message", role: "user", content: [
          { type: "input_text", text: inputText },
          { type: "input_image", image_url: `data:image/jpeg;base64,${original.toString("base64")}` },
        ] }],
      }),
    });
  } catch {
    if (signal.aborted) throw new AiFailure("AI_TIMEOUT", "AI took too long. Your original photo is unchanged.", 503, false);
    throw new AiFailure("PROVIDER_TRANSPORT", "The cutout service could not be reached. Try again later.", 503, false);
  }
  checkProviderResponse(response);
  try {
    return await parseImageStream(responseEvents(response)).finalResult;
  } catch (error) {
    if (error instanceof AiFailure) throw error;
    throw new AiFailure("MASK_PARSE", "The cutout service returned an unreadable mask. Try again later.", 503, false);
  }
}

function sanitizePrompt(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!cleaned) return "item";
  // SAM concept prompt must be short noun phrase; strip control chars and keep visible.
  const safe = cleaned.replace(/[\u0000-\u001f\u007f]/g, "");
  return safe.length ? safe : "item";
}

export async function composeCutout(original: Buffer, alpha: Uint8Array, width: number, height: number): Promise<Buffer> {
  if (alpha.length !== width * height) throw new AiFailure("MASK_INVALID", "The cutout mask did not match the photo.");
  const rgb = await sharp(original, { limitInputPixels: 4000000 }).removeAlpha().raw().toBuffer();
  if (rgb.length !== width * height * 3) throw new AiFailure("MASK_INVALID", "The cutout could not be composed safely.");
  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0, pixel = 0; source < rgb.length; source += 3, target += 4, pixel++) {
    rgba[target] = rgb[source];
    rgba[target + 1] = rgb[source + 1];
    rgba[target + 2] = rgb[source + 2];
    rgba[target + 3] = alpha[pixel];
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .flatten({ background: "#f2f1ed" })
    .jpeg({ quality: 84 })
    .toBuffer();
}

export async function makeCutout(input: { original: Buffer; prompt: string; key: string; signal: AbortSignal }): Promise<Buffer> {
  const metadata = await sharp(input.original, { limitInputPixels: 4000000 }).metadata();
  const width = metadata.width!; const height = metadata.height!;
  if (!width || !height || width > 1600 || height > 1600) throw new AiFailure("IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
  const safePrompt = sanitizePrompt(input.prompt);
  const result = await requestSam(input.original, safePrompt, input.key, input.signal);
  if (result.outcome.status !== "completed" || result.diagnostics.some((item) => item.severity === "error")) throw new AiFailure("MASK_INVALID", "The item could not be cut out reliably. Your original photo is unchanged.");
  const masks = recordsOfKind(result.records, "mask");
  const candidates: { pixels: Buffer; area: number }[] = [];
  for (const record of masks.slice(0, 16)) {
    const { left, top, right, bottom } = record.bounds;
    if (record.mask.width * record.mask.height > 4000000) continue;
    if (![left, top, right, bottom].every(Number.isInteger) || left < 0 || top < 0 || right > width || bottom > height || right <= left || bottom <= top) continue;
    try {
      const candidate = await maskRecordToCanvas(record, width, height);
      candidates.push({ pixels: candidate.pixels, area: candidate.coverage });
    } catch (error) {
      if (error instanceof AiFailure && error.code.startsWith("MASK_QUALITY_")) continue;
      throw error;
    }
  }
  if (candidates.length !== 1) throw new AiFailure("MASK_AMBIGUOUS", "No single clear item matched that prompt. Try a short item name and a photo with one main object. Your original is unchanged.");
  return composeCutout(input.original, candidates[0].pixels, width, height);
}

export async function makeBoxCutout(input: { original: Buffer; box: NativeCutoutBox; key: string; signal: AbortSignal }): Promise<{ processed: Buffer; maskCount: number; coverage: number; components: number }> {
  const metadata = await sharp(input.original, { limitInputPixels: 4000000 }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width > 1600 || height > 1600) throw new AiFailure("IMAGE_SIZE", "Use a photo of at most 1600 pixels per side.");
  const box = input.box;
  if (![box.left, box.top, box.right, box.bottom].every(Number.isInteger)
    || box.left < 0 || box.top < 0 || box.right > width || box.bottom > height || box.right <= box.left || box.bottom <= box.top) {
    throw new AiFailure("BOX_INVALID", "The marked box is outside the uploaded photo.", 400, false);
  }
  let objectPrompt: string;
  try {
    objectPrompt = buildObjectPrompt({
      size: { width, height },
      objects: [{ id: 1, prompts: [{ frame: 0, box }] }],
    });
  } catch {
    throw new AiFailure("BOX_INVALID", "The marked box could not be encoded safely.", 400, false);
  }
  const result = await requestSam(input.original, objectPrompt, input.key, input.signal);
  if (result.outcome.status !== "completed") throw new AiFailure("MASK_INCOMPLETE", "The cutout service did not finish. Try again later.");
  if (result.diagnostics.some((item) => item.severity === "error")) throw new AiFailure("MASK_PARSE", "The cutout service returned an invalid mask. Try again later.");
  const masks = recordsOfKind(result.records, "mask");
  const canvas = await maskRecordToCanvas(selectBoxMaskRecord(masks), width, height);
  let processed: Buffer;
  try {
    processed = await composeCutout(input.original, canvas.pixels, width, height);
  } catch {
    throw new AiFailure("COMPOSITION_INVALID", "The cutout could not be composed safely. Your original photo is unchanged.");
  }
  return { processed, maskCount: masks.length, coverage: canvas.coverage, components: canvas.components };
}
