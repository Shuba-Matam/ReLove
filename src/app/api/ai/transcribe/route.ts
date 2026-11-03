import { assertTrustedBounds, requireAiContext, runAi } from "@/lib/ai/context";
import { validateWav } from "@/lib/ai/audio";
import { transcriptionResponseSchema } from "@/lib/ai/schemas";
import { checkProviderResponse, PROVIDER_LIMITS, readLimitedText } from "@/lib/ai/provider";
import { ApiProblem, assertSameOrigin, json, readFormLimited, withApi } from "@/lib/server/http";
import { getAiMaxRetries } from "@/lib/server/env";

/**
 * POST /api/ai/transcribe — multipart file -> { transcript }. WAV mono 16-bit 16/24kHz max 60s.
 * Verified against Meta endpoint docs; Zod all inputs/provider outputs; manual fallback.
 * Bounded: request 3.2MiB, file 3MiB/60s; listing-only (draft helper), not search/messages.
 * Trusted server-validated usage dimensions enforced before provider; maxDurationSec from pricebook.
 */
export const runtime = "nodejs";
export const maxDuration = 30;
export const POST = withApi(async (request: Request) => {
  assertSameOrigin(request);
  if (Number(request.headers.get("content-length") || 0) > 3200000) throw new ApiProblem(413, "AUDIO_SIZE", "Record a clip of up to 60 seconds.");
  const form = await readFormLimited(request, PROVIDER_LIMITS.maxAudioBytes + 200000);
  const file = form.get("file");
  if (!(file instanceof File) || file.size > PROVIDER_LIMITS.maxAudioBytes || file.size < 44) throw new ApiProblem(400, "AUDIO_INVALID", "Record a short audio clip first.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let validated: { durationSeconds: number; sampleRate: number };
  try {
    validated = validateWav(bytes);
  } catch (error) {
    throw new ApiProblem(400, "AUDIO_INVALID", error instanceof Error ? error.message : "Record a supported audio clip.");
  }
  const { createHash } = await import("node:crypto");
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || sourceHash.slice(0, 32);
  const { key, ledger, pricebookRow } = await requireAiContext("transcribe", { sourceHash, idempotencyKey });

  // Integrate trusted server-validated usage dimensions: audioDurationSec and bytes before provider
  assertTrustedBounds(pricebookRow, {
    audioDurationSec: Math.ceil(validated.durationSeconds),
    imageBytes: undefined,
    inputChars: undefined,
    outputTokens: undefined,
  });
  // Also enforce maxDurationSec from pricebook explicitly
  if (pricebookRow.max_duration_sec !== null && validated.durationSeconds > pricebookRow.max_duration_sec) {
    throw new ApiProblem(400, "AUDIO_SIZE", "Record a clip of up to 60 seconds.");
  }

  const fileForProvider = new File([bytes], "recording.wav", { type: "audio/wav" });
  const transcript = await runAi(
    ledger,
    async (signal) => {
      const outgoing = new FormData();
      outgoing.set("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["English", "Tamil"] })], { type: "application/json" }));
      outgoing.set("audio", fileForProvider, "recording.wav");
      const response = await fetch("https://api.meta.ai/v1/asr/transcribe", {
        method: "POST",
        signal,
        cache: "no-store",
        redirect: "error",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        body: outgoing,
      });
      checkProviderResponse(response);
      const parsed = JSON.parse(await readLimitedText(response, PROVIDER_LIMITS.maxOutputChars));
      return transcriptionResponseSchema.parse(parsed).transcript;
    },
    {
      maxRetries: getAiMaxRetries(),
      validateCached: (cached) => {
        if (typeof cached === "string") {
          const trimmed = cached.trim();
          return trimmed.length >= 1 && trimmed.length <= 3000 ? trimmed : null;
        }
        if (cached && typeof cached === "object" && "transcript" in (cached as Record<string, unknown>)) {
          const t = (cached as { transcript?: unknown }).transcript;
          if (typeof t === "string" && t.trim().length >= 1 && t.trim().length <= 3000) return t.trim();
        }
        return null;
      },
    }
  );
  return json({ transcript });
});
