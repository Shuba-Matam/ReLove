import { requireAiContext, runAi } from "@/lib/ai/context";
import { validateWav } from "@/lib/ai/audio";
import { transcriptionResponseSchema } from "@/lib/ai/schemas";
import { checkProviderResponse, PROVIDER_LIMITS, readLimitedText } from "@/lib/ai/provider";
import { ApiProblem, assertSameOrigin, json, readFormLimited, withApi } from "@/lib/server/http";

/**
 * POST /api/ai/transcribe — multipart file -> { transcript }. WAV mono 16-bit 16/24kHz max 60s.
 * Verified against Meta endpoint docs; Zod all inputs/provider outputs; manual fallback.
 * Bounded: request 3.2MiB, file 3MiB/60s; listing-only (draft helper), not search/messages.
 */
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  if (Number(request.headers.get("content-length") || 0) > 3200000) throw new ApiProblem(413, "AUDIO_SIZE", "Record a clip of up to 60 seconds.");
  const form = await readFormLimited(request, PROVIDER_LIMITS.maxAudioBytes + 200000); const file = form.get("file");
  if (!(file instanceof File) || file.size > PROVIDER_LIMITS.maxAudioBytes || file.size < 44) throw new ApiProblem(400, "AUDIO_INVALID", "Record a short audio clip first.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { validateWav(bytes); }
  catch (error) { throw new ApiProblem(400, "AUDIO_INVALID", error instanceof Error ? error.message : "Record a supported audio clip."); }
  const { createHash } = await import("node:crypto");
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || sourceHash.slice(0, 32);
  const { key, ledger } = await requireAiContext("transcribe", { sourceHash, idempotencyKey });
  // need to recreate file from bytes for fetch (already consumed); recreate Blob
  const fileForProvider = new File([bytes], "recording.wav", { type: "audio/wav" });
  try {
    const transcript = await runAi(ledger, async (signal) => {
      const outgoing = new FormData();
      outgoing.set("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["English", "Tamil"] })], { type: "application/json" }));
      outgoing.set("audio", fileForProvider, "recording.wav");
      const response = await fetch("https://api.meta.ai/v1/asr/transcribe", { method: "POST", signal, cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: outgoing });
      checkProviderResponse(response);
      const parsed = JSON.parse(await readLimitedText(response, PROVIDER_LIMITS.maxOutputChars));
      return transcriptionResponseSchema.parse(parsed).transcript;
    }, 1);
    return json({ transcript });
  } catch (e) {
    const { AiFailure } = await import("@/lib/ai/guard");
    if (e instanceof AiFailure && e.code === "AI_DUPLICATE_DONE") return json({ transcript: (e.data as { transcript?: string })?.transcript ?? e.data, duplicate: true, disposition: "duplicate_done" });
    if (e instanceof AiFailure && e.code === "AI_DUPLICATE_PENDING") throw new ApiProblem(409, "AI_PENDING", "Duplicate transcribe already pending.");
    throw e;
  }
});
