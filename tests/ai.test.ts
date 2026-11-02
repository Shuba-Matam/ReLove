import { afterEach, describe, expect, it, vi } from "vitest";
import { AiFailure, runGuardedAi, type UsageLedger } from "@/lib/ai/guard";
import { draftRequestSchema, parseAiDraft, transcriptionResponseSchema } from "@/lib/ai/schemas";
import { checkMask, priceWarning } from "@/lib/ai/rules";
import { validateWav } from "@/lib/ai/audio";

const draft = { title: "Desk chair", description: "A chair with a padded seat.", category_slug: "furniture", tags: ["chair", "seat"], condition_hint: null, brand: null, edition: null };
const ledger = (): UsageLedger => ({ reserve: vi.fn(async () => ({ allowed: true, usageId: "usage" })), complete: vi.fn(async () => undefined) });
afterEach(() => vi.useRealTimers());
describe("AI draft validation and seller authority", () => {
  it("accepts valid JSON but discards condition, brand, and edition guesses", () => {
    const result = parseAiDraft(JSON.stringify({ ...draft, brand: "Imagined", edition: "Third", condition_hint: "new" }));
    expect(result).toMatchObject({ brand: null, edition: null, condition_hint: null });
  });
  it("rejects invented price fields, invalid categories, bad JSON and excessive output", () => {
    expect(() => parseAiDraft(JSON.stringify({ ...draft, price: 999 }))).toThrow();
    expect(() => parseAiDraft(JSON.stringify({ ...draft, category_slug: "weapons" }))).toThrow();
    expect(() => parseAiDraft("not JSON")).toThrow();
    expect(() => parseAiDraft("x".repeat(18001))).toThrow();
  });
  it("warns on zero and large prices without deciding a price for the seller", () => {
    expect(priceWarning(0)).toContain("free"); expect(priceWarning(250001)).toContain("high"); expect(priceWarning(450)).toBeNull();
  });
  it("validates draft request requires image or transcript and rejects bad paths", () => {
    expect(draftRequestSchema.safeParse({}).success).toBe(false);
    expect(draftRequestSchema.safeParse({ transcript: "  " }).success).toBe(false);
    expect(draftRequestSchema.safeParse({ image_path: "not-a-path" }).success).toBe(false);
    expect(draftRequestSchema.safeParse({ image_path: "11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg" }).success).toBe(true);
    expect(draftRequestSchema.safeParse({ transcript: "a chair" }).success).toBe(true);
  });
  it("normalizes tags to lowercased deduplicated set and strips fences", () => {
    const raw = "```json\n" + JSON.stringify({ ...draft, tags: ["Chair", "chair", " SEAT "] }) + "\n```";
    const parsed = parseAiDraft(raw);
    expect(parsed.tags).toEqual(["chair", "seat"]);
  });
  it("rejects extra keys like price even when wrapped in markdown", () => {
    expect(() => parseAiDraft("```json\n" + JSON.stringify({ ...draft, price_inr: 100 }) + "\n```")).toThrow();
  });
});
describe("AI failure drills", () => {
  it("makes no call or reservation with the kill switch off", async () => {
    const usage = ledger(); const operation = vi.fn();
    await expect(runGuardedAi({ enabled: false, ledger: usage, operation })).rejects.toMatchObject({ code: "AI_DISABLED" });
    expect(operation).not.toHaveBeenCalled(); expect(usage.reserve).not.toHaveBeenCalled();
  });
  it("stops before a provider call when the cap is reached", async () => {
    const usage = ledger(); usage.reserve = vi.fn(async () => ({ allowed: false, usageId: null })); const operation = vi.fn();
    await expect(runGuardedAi({ enabled: true, ledger: usage, operation })).rejects.toMatchObject({ status: 429 });
    expect(operation).not.toHaveBeenCalled();
  });
  it("reserves and logs every attempt and never retries more than twice", async () => {
    const usage = ledger(); const operation = vi.fn(async () => { throw new AiFailure("PROVIDER", "Unavailable", 503, true); });
    await expect(runGuardedAi({ enabled: true, ledger: usage, operation, maxRetries: 99 })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(3); expect(usage.reserve).toHaveBeenCalledTimes(3); expect(usage.complete).toHaveBeenCalledTimes(3);
  });
  it("does not retry a bad credential response", async () => {
    const operation = vi.fn(async () => { throw new AiFailure("KEY", "Unavailable", 503, false); });
    await expect(runGuardedAi({ enabled: true, ledger: ledger(), operation })).rejects.toThrow(); expect(operation).toHaveBeenCalledTimes(1);
  });
  it("aborts on the total timeout and logs the failed reservation", async () => {
    vi.useFakeTimers(); const usage = ledger(); let signal: AbortSignal | undefined;
    const running = runGuardedAi({ enabled: true, ledger: usage, timeoutMs: 100, operation: async (input) => { signal = input; return await new Promise<never>(() => {}); } });
    const asserted = expect(running).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(101); await asserted; expect(signal?.aborted).toBe(true); expect(usage.complete).toHaveBeenCalledOnce();
  });
  it("recovers from one malformed draft and stops on success", async () => {
    const usage = ledger(); const operation = vi.fn(async (_signal, attempt) => { if (!attempt) throw new AiFailure("JSON", "Invalid", 503, true); return draft; });
    expect(await runGuardedAi({ enabled: true, ledger: usage, operation, maxRetries: 1 })).toEqual(draft); expect(usage.reserve).toHaveBeenCalledTimes(2);
  });
});
describe("cutout mask quality", () => {
  it("rejects tiny, full-frame, fragmented, and dimension-mismatched masks", () => {
    expect(checkMask(new Uint8Array(100), 10, 10).reason).toBe("tiny");
    expect(checkMask(new Uint8Array(100).fill(1), 10, 10).reason).toBe("full_frame");
    expect(checkMask(new Uint8Array(10), 10, 10).reason).toBe("dimensions");
    const mask = new Uint8Array(100); for (let y = 0; y < 10; y += 2) for (let x = 0; x < 10; x += 2) mask[y * 10 + x] = 1;
    expect(checkMask(mask, 10, 10).reason).toBe("fragmented");
  });
  it("accepts a coherent foreground region", () => {
    const mask = new Uint8Array(100); for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) mask[y * 10 + x] = 1;
    expect(checkMask(mask, 10, 10)).toMatchObject({ valid: true, components: 1, coverage: 0.25 });
  });
  it("rejects near-full-frame masks above 95% coverage", () => {
    const mask = new Uint8Array(100); for (let i = 0; i < 96; i++) mask[i] = 1;
    expect(checkMask(mask, 10, 10).reason).toBe("full_frame");
  });
  it("rejects tiny masks below 1.5% coverage", () => {
    const mask = new Uint8Array(100); mask[0] = 1;
    expect(checkMask(mask, 10, 10).reason).toBe("tiny");
  });
  it("accepts coverage just above tiny threshold", () => {
    const mask = new Uint8Array(100); mask[0] = 1; mask[1] = 1;
    expect(checkMask(mask, 10, 10).valid).toBe(true);
  });
});
describe("audio validation", () => {
  it("accepts Meta response metadata without returning it to the browser", () => {
    expect(transcriptionResponseSchema.parse({ sessionId: "test", transcript: " A chair ", audioDurationMs: 1000, turns: [] }))
      .toEqual({ transcript: "A chair" });
    expect(transcriptionResponseSchema.safeParse({ transcript: " " }).success).toBe(false);
    expect(transcriptionResponseSchema.safeParse({ transcript: 42 }).success).toBe(false);
  });
  it("rejects non-WAV and wrong format", () => {
    expect(() => validateWav(new TextEncoder().encode("not wav"))).toThrow();
  });
  it("validates mono 16-bit PCM at 16k and 24k up to 60s", () => {
    const makeWav = (sampleRate: number, dataSamples: number) => {
      const bytes = new Uint8Array(44 + dataSamples * 2);
      const view = new DataView(bytes.buffer);
      const text = (i: number, s: string) => [...s].forEach((c, o) => view.setUint8(i + o, c.charCodeAt(0)));
      text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, "data"); view.setUint32(40, dataSamples * 2, true);
      return bytes;
    };
    expect(validateWav(makeWav(16000, 16000)).sampleRate).toBe(16000);
    expect(validateWav(makeWav(24000, 24000)).sampleRate).toBe(24000);
    expect(() => validateWav(makeWav(8000, 100))).toThrow();
    expect(() => validateWav(makeWav(16000, 16000 * 61))).toThrow();
  });
});
