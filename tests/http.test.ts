import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, readBodyLimited, readJson, sanitizeNextPath } from "@/lib/server/http";
import { listingUpdateSchema } from "@/lib/validation";
import { validateWav } from "@/lib/ai/audio";
import { listListings } from "@/lib/server/queries";
import { POST as draft } from "@/app/api/ai/draft/route";
import { POST as logout } from "@/app/auth/logout/route";

afterEach(() => vi.unstubAllEnvs());
describe("server boundaries", () => {
  it("rejects encoded redirect tricks", () => {
    for (const next of ["/%5cevil.test", "/%09/evil.test", "//evil.test", "/auth/logout", "https://evil.test"]) expect(sanitizeNextPath(next)).toBe("/");
    expect(sanitizeNextPath("/sell?from=home")).toBe("/sell?from=home");
  });
  it("rejects missing origins, insecure origins, and spoofed forwarding hosts", () => {
    const url = "https://relove.test/api/listings";
    const cases: Record<string,string>[] = [{}, { origin: "http://relove.test" }, { origin: "https://evil.test", "x-forwarded-host": "evil.test" }];
    for (const headers of cases) {
      expect(() => assertSameOrigin(new Request(url, { method: "POST", headers }))).toThrow();
    }
  });
  it("bounds streamed bodies even without Content-Length", async () => {
    const request = new Request("https://relove.test/api/listings", { method: "POST", body: "x".repeat(1025) });
    await expect(readBodyLimited(request, 1024)).rejects.toMatchObject({ status: 413 });
  });
  it("accepts only JSON content types and validated inputs", async () => {
    await expect(readJson(new Request("https://relove.test", { method: "POST", body: "{}" }), z.object({}))).rejects.toMatchObject({ status: 415 });
  });
  it("requires renewed confirmation on edits, while permitting mark-sold", () => {
    expect(listingUpdateSchema.safeParse({ title: "Changed title" }).success).toBe(false);
    expect(listingUpdateSchema.safeParse({ title: "Changed title", seller_confirmed: true }).success).toBe(true);
    expect(listingUpdateSchema.safeParse({ status: "sold" }).success).toBe(true);
    expect(listingUpdateSchema.parse({ status: "sold" })).not.toHaveProperty("tags");
  });
  it("never fabricates demo data when live configuration is missing", async () => {
    vi.stubEnv("APP_MODE", "live"); vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", ""); vi.stubEnv("SUPABASE_ANON_KEY", "");
    await expect(listListings({})).rejects.toMatchObject({ status: 503 });
  });
  it("blocks AI in demo before provider access, even if the switch is true", async () => {
    vi.stubEnv("APP_MODE", "demo"); vi.stubEnv("AI_ENABLED", "true");
    const response = await draft(new NextRequest("https://relove.test/api/ai/draft", { method: "POST", headers: { Origin: "https://relove.test", "Content-Type": "application/json" }, body: JSON.stringify({ transcript: "chair" }) }));
    expect(response.status).toBe(403);
  });
  it("does not sign out on a forged mutation", async () => {
    const response = await logout(new NextRequest("https://relove.test/auth/logout", { method: "POST", headers: { Origin: "https://evil.test" } }));
    expect(response.status).toBe(403);
  });
  it("validates WAV PCM data and rejects mislabeled webm", () => {
    expect(() => validateWav(new TextEncoder().encode("not really wav"))).toThrow();
    const bytes = new Uint8Array(364); const view = new DataView(bytes.buffer);
    const text = (index: number, str: string) => [...str].forEach((letter, offset) => view.setUint8(index + offset, letter.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, 356, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, 320, true);
    expect(validateWav(bytes).sampleRate).toBe(16000);
    view.setUint16(22, 2, true); expect(() => validateWav(bytes)).toThrow();
  });
});
