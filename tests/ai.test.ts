import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { AiFailure, runGuardedAi, type UsageLedger } from "@/lib/ai/guard";
import { draftRequestSchema, parseAiDraft, transcriptionResponseSchema } from "@/lib/ai/schemas";
import { checkMask, priceWarning } from "@/lib/ai/rules";
import { validateWav } from "@/lib/ai/audio";
import { classifyProviderStatus, PROVIDER_LIMITS, getDraftProvider } from "@/lib/ai/provider";
import sharp from "sharp";

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
  it("supports bounded feedback and accepts legacy cached drafts without feedback", () => {
    expect(parseAiDraft(JSON.stringify(draft)).feedback).toBeUndefined();
    const result = parseAiDraft(JSON.stringify({
      ...draft,
      feedback: {
        missing_details: ["Is the charger included?", "Is the charger included?"],
        photo_guidance: ["The item is small in the frame."],
      },
    }));
    expect(result.feedback).toEqual({ missing_details: ["Is the charger included?"], photo_guidance: ["The item is small in the frame."] });
    expect(() => parseAiDraft(JSON.stringify({ ...draft, feedback: { missing_details: ["x".repeat(141)], photo_guidance: [] } }))).toThrow();
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
  it("parses the installed SAM stream format into a bounded mask raster", async () => {
    const outputText = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
    async function* events() {
      yield { type: "response.output_text.delta", item_id: "message-1", output_index: 0, content_index: 0, delta: outputText };
      yield { type: "response.output_text.done", item_id: "message-1", output_index: 0, content_index: 0, text: outputText };
      yield { type: "response.completed" };
    }
    const result = await parseImageStream(events()).finalResult;
    const mask = recordsOfKind(result.records, "mask")[0];
    expect(result.outcome.status).toBe("completed");
    expect(mask.bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    expect(decodeMaskToRaster(mask.mask)).toHaveLength(27 * 60);
  });
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
  it("composes a validated mask into a visible neutral background instead of returning the original", async () => {
    const { composeCutout } = await import("@/lib/ai/cutout");
    const width = 20; const height = 20;
    const original = await sharp({ create: { width, height, channels: 3, background: { r: 190, g: 25, b: 30 } } }).jpeg().toBuffer();
    const mask = new Uint8Array(width * height);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * width + x] = 255;
    const cutout = await composeCutout(original, mask, width, height);
    const { data } = await sharp(cutout).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));
    expect(pixel(0, 0)).toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]));
    expect(pixel(0, 0)[0]).toBeGreaterThan(225);
    expect(pixel(10, 10)[0]).toBeLessThan(220);
  });
  it("keeps an asymmetric off-origin SAM mask aligned after the raw resize pipeline", async () => {
    const outputText = '<0f>0<|box;x1=29;y1=41;x2=88;y2=67;w=120;h=100|>' +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
    const events = [
      { type: "response.output_text.delta", item_id: "message-1", output_index: 0, content_index: 0, delta: outputText },
      { type: "response.output_text.done", item_id: "message-1", output_index: 0, content_index: 0, text: outputText },
      { type: "response.completed" },
    ];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const original = await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: 185, g: 30, b: 35 } } }).jpeg().toBuffer();
    const parsed = await parseImageStream((async function* () { for (const event of events) yield event; })()).finalResult;
    const record = recordsOfKind(parsed.records, "mask")[0];
    const raster = decodeMaskToRaster(record.mask);
    const surroundedIndex = (value: 0 | 1) => raster.findIndex((pixel, index) => {
      const x = index % record.mask.width; const y = Math.floor(index / record.mask.width);
      if (pixel !== value || x < 1 || y < 1 || x >= record.mask.width - 1 || y >= record.mask.height - 1) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (raster[(y + dy) * record.mask.width + x + dx] !== value) return false;
      return true;
    });
    const foreground = surroundedIndex(1); const background = surroundedIndex(0);
    expect(foreground).toBeGreaterThanOrEqual(0); expect(background).toBeGreaterThanOrEqual(0);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as unknown as typeof fetch;
    try {
      const { makeCutout } = await import("@/lib/ai/cutout");
      const cutout = await makeCutout({ original, prompt: "chair", key: "offline-test", signal: new AbortController().signal });
      const { data } = await sharp(cutout).raw().toBuffer({ resolveWithObject: true });
      const outputPixel = (index: number) => {
        const x = record.bounds.left + index % record.mask.width;
        const y = record.bounds.top + Math.floor(index / record.mask.width);
        return Array.from(data.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3));
      };
      const foregroundPixel = outputPixel(foreground);
      const backgroundPixel = outputPixel(background);
      expect(foregroundPixel[0]).toBeGreaterThan(140);
      expect(foregroundPixel[1]).toBeLessThan(90);
      expect(backgroundPixel[0]).toBeGreaterThan(220);
      expect(backgroundPixel[1]).toBeGreaterThan(215);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it("makes a real box-prompt SAM cutout with object 1 and keeps an irregular off-origin mask aligned", async () => {
    const outputText = '<0f>1<|box;x1=29;y1=41;x2=88;y2=67;w=120;h=100|>' +
      "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
    const events = [
      { type: "response.output_text.delta", item_id: "message-1", output_index: 0, content_index: 0, delta: outputText },
      { type: "response.output_text.done", item_id: "message-1", output_index: 0, content_index: 0, text: outputText },
      { type: "response.completed" },
    ];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
    const original = await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: 185, g: 30, b: 35 } } }).jpeg().toBuffer();
    const parsed = await parseImageStream((async function* () { for (const event of events) yield event; })()).finalResult;
    const record = recordsOfKind(parsed.records, "mask")[0];
    const raster = decodeMaskToRaster(record.mask);
    const surroundedIndex = (value: 0 | 1) => raster.findIndex((pixel, index) => {
      const x = index % record.mask.width; const y = Math.floor(index / record.mask.width);
      if (pixel !== value || x < 1 || y < 1 || x >= record.mask.width - 1 || y >= record.mask.height - 1) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (raster[(y + dy) * record.mask.width + x + dx] !== value) return false;
      return true;
    });
    const foreground = surroundedIndex(1);
    const background = surroundedIndex(0);
    expect(foreground).toBeGreaterThanOrEqual(0);
    expect(background).toBeGreaterThanOrEqual(0);
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const { makeBoxCutout } = await import("@/lib/ai/cutout");
      const result = await makeBoxCutout({ original, box: { left: 20, top: 30, right: 100, bottom: 80 }, key: "offline-test", signal: new AbortController().signal });
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const requestBody = JSON.parse(String(call[1].body));
      expect(requestBody.input[0].content[0].text).toBe("<0f>1<|box;x1=20;y1=30;x2=99;y2=79;w=120;h=100|>");
      const { data } = await sharp(result.processed).raw().toBuffer({ resolveWithObject: true });
      const outputPixel = (index: number) => {
        const x = record.bounds.left + index % record.mask.width;
        const y = record.bounds.top + Math.floor(index / record.mask.width);
        return Array.from(data.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3));
      };
      expect(outputPixel(foreground)[0]).toBeGreaterThan(140);
      expect(outputPixel(background)[0]).toBeGreaterThan(220);
      expect(record.objectId).toBe("1");
      expect(record.frame?.frameIndex ?? 0).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
describe("provider hardening — low-funds, nonretryable, bounded sizes, draft provider", () => {
  beforeEach(() => vi.unstubAllEnvs());
  it("classifies 402 payment vs 403 forbidden as distinct non-retryable vs 429 retryable", () => {
    expect(classifyProviderStatus(402)).toMatchObject({ code: "AI_PAYMENT", retryable: false });
    expect(classifyProviderStatus(403)).toMatchObject({ code: "AI_FORBIDDEN", retryable: false });
    expect(classifyProviderStatus(401)).toMatchObject({ code: "AI_CREDENTIALS", retryable: false });
    expect(classifyProviderStatus(413)).toMatchObject({ code: "AI_SIZE", retryable: false });
    expect(classifyProviderStatus(429)).toMatchObject({ code: "AI_RATE_LIMIT", retryable: true });
    expect(classifyProviderStatus(500)).toMatchObject({ retryable: true });
    expect(classifyProviderStatus(400)).toMatchObject({ code: "AI_INVALID", retryable: false });
    expect(classifyProviderStatus(402).message).not.toContain("depleted");
    expect(classifyProviderStatus(403).message).not.toContain("depleted");
  });
  it("exposes bounded limits for image/output/audio (listing-only AI, no search/messages cost)", () => {
    expect(PROVIDER_LIMITS.maxImageBytes).toBe(2 * 1024 * 1024);
    expect(PROVIDER_LIMITS.maxAudioBytes).toBe(3_000_000);
    expect(PROVIDER_LIMITS.maxOutputChars).toBe(32000);
    expect(PROVIDER_LIMITS.maxDraftChars).toBe(18000);
  });
  it("defaults draft provider to baseten, meta only when explicitly set (no silent switch)", () => {
    vi.stubEnv("AI_DRAFT_PROVIDER", "");
    expect(getDraftProvider()).toBe("baseten");
    vi.stubEnv("AI_DRAFT_PROVIDER", "baseten");
    expect(getDraftProvider()).toBe("baseten");
    vi.stubEnv("AI_DRAFT_PROVIDER", "meta");
    expect(getDraftProvider()).toBe("meta");
    vi.stubEnv("AI_DRAFT_PROVIDER", "llama");
    expect(() => getDraftProvider()).toThrow();
  });
  it("does not retry on 402 payment vs retries on 429 only if deadline allows", async () => {
    const payOp = vi.fn(async () => { throw new AiFailure("AI_PAYMENT", "AI billing requires attention.", 503, false); });
    const ledgerQ = ledger();
    await expect(runGuardedAi({ enabled: true, ledger: ledgerQ, operation: payOp })).rejects.toMatchObject({ code: "AI_PAYMENT" });
    expect(payOp).toHaveBeenCalledTimes(1);
    expect(ledgerQ.complete).toHaveBeenCalledTimes(1);
    const rateOp = vi.fn(async () => { throw new AiFailure("AI_RATE_LIMIT", "busy", 503, true); });
    const ledgerR = ledger();
    await expect(runGuardedAi({ enabled: true, ledger: ledgerR, operation: rateOp, maxRetries: 2, timeoutMs: 5000 })).rejects.toThrow();
    expect(rateOp).toHaveBeenCalledTimes(3);
  });
  it("honors fail-closed deadline even when provider hangs", async () => {
    vi.useFakeTimers();
    const usage = ledger();
    let aborted = false;
    const op = vi.fn(async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<never>(() => {});
    });
    const running = runGuardedAi({ enabled: true, ledger: usage, timeoutMs: 50, operation: op });
    const assert = expect(running).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60);
    await assert;
    expect(aborted).toBe(true);
    expect(usage.complete).toHaveBeenCalledWith(expect.any(String), false, expect.any(Number));
    vi.useRealTimers();
  });
  it("does not start provider after reserve deadline, records reserved failure", async () => {
    vi.useFakeTimers();
    const usage = ledger();
    usage.reserve = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { allowed: true, usageId: "usage" };
    });
    const op = vi.fn(async () => "ok");
    const running = runGuardedAi({ enabled: true, ledger: usage, timeoutMs: 50, operation: op as unknown as (s: AbortSignal, a: number) => Promise<string> });
    const assert = expect(running).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(90);
    await assert;
    expect(op).not.toHaveBeenCalled();
    expect(usage.complete).toHaveBeenCalledWith("usage", false, expect.any(Number));
    vi.useRealTimers();
  });
  it("counts every attempt including retries and failures atomically (global50/user5 UTC model)", async () => {
    const usage = ledger();
    const op = vi.fn()
      .mockRejectedValueOnce(new AiFailure("AI_PROVIDER", "oops", 503, true))
      .mockResolvedValueOnce({ title: "ok" } as unknown as string);
    const result = await runGuardedAi({ enabled: true, ledger: usage, operation: op as unknown as (s: AbortSignal, a: number) => Promise<string>, maxRetries: 1 });
    expect(result).toEqual({ title: "ok" });
    expect(usage.reserve).toHaveBeenCalledTimes(2);
    expect(usage.complete).toHaveBeenCalledTimes(2);
    expect(usage.complete).toHaveBeenNthCalledWith(1, expect.any(String), false, expect.any(Number));
    expect(usage.complete).toHaveBeenNthCalledWith(2, expect.any(String), true, expect.any(Number));
  });
  it("draft provider selection retains Baseten compatibility and Meta uses fixed api.meta.ai with allowlisted model", async () => {
    const originalFetch = globalThis.fetch;
    const mocked = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("inference.baseten.co")) {
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/responses/input_tokens")) {
        return new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body ?? "{}"));
      const reservesBudgetForVisibleJson = body.max_completion_tokens === 1200 && body.reasoning_effort === "minimal" && !("max_tokens" in body);
      return new Response(JSON.stringify({
        choices: [reservesBudgetForVisibleJson
          ? { finish_reason: "stop", message: { content: JSON.stringify(draft) } }
          : { finish_reason: "length", message: { content: null } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    globalThis.fetch = mocked as unknown as typeof fetch;
    vi.stubEnv("AI_DRAFT_PROVIDER", "baseten");
    vi.stubEnv("BASETEN_MODEL", "meta-models/muse-spark-open-1026");
    const { basetenCompletion } = await import("@/lib/ai/provider");
    await basetenCompletion("test-key", [{ type: "text", text: "hi" }], "prompt", AbortSignal.timeout(1000));
    expect(mocked).toHaveBeenCalledWith(expect.stringContaining("inference.baseten.co"), expect.objectContaining({ method: "POST" }));
    mocked.mockClear();
    vi.stubEnv("AI_DRAFT_PROVIDER", "meta");
    vi.stubEnv("META_MODEL", "muse-spark-1.3");
    const { metaCompletion } = await import("@/lib/ai/provider");
    const pricebook = { feature: "draft", provider: "meta", model: "muse-spark-1.3", max_cost_micro_usd: 8500, enabled: true, input_max_chars: 8000, output_max_tokens: 1200, max_duration_sec: null, version: 1 };
    await metaCompletion("meta-key", [{ type: "text", text: "hi" }], "prompt", AbortSignal.timeout(1000), pricebook);
    expect(mocked).toHaveBeenNthCalledWith(1, "https://api.meta.ai/v1/responses/input_tokens", expect.objectContaining({ method: "POST" }));
    expect(mocked).toHaveBeenNthCalledWith(2, "https://api.meta.ai/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    const call = mocked.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse((call[1].body as string) ?? "{}");
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.max_completion_tokens).toBe(1200);
    expect(body.reasoning_effort).toBe("minimal");
    expect(body).not.toHaveProperty("max_tokens");
    vi.stubEnv("META_MODEL", "Llama-4-Maverick-17B-128E-Instruct-FP8");
    await expect(metaCompletion("meta-key", [{ type: "text", text: "hi" }], "prompt", AbortSignal.timeout(1000), pricebook)).rejects.toMatchObject({ code: "AI_PROVIDER" });
    globalThis.fetch = originalFetch;
  });
});
