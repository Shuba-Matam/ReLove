import { afterEach, describe, expect, it, vi } from "vitest";
import { AiFailure, runGuardedAi, type UsageLedger } from "@/lib/ai/guard";
import { parseAiDraft } from "@/lib/ai/schemas";
import { checkMask, priceWarning } from "@/lib/ai/rules";

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
});
