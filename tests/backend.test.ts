import { describe, it, expect, beforeEach } from "vitest";
import { ApiProblem, assertSameOrigin, sanitizeNextPath } from "@/lib/server/http";
import { getAppMode } from "@/lib/server/env";
import { listingFiltersSchema, listingSchema, imagePathSchema, profileSchema, messageSchema, reportSchema } from "@/lib/validation";
import { DEMO_LISTINGS, DEMO_PROFILES } from "@/lib/demo";
import { CATEGORIES } from "@/lib/marketplace";

function mockRequest(init: { method?: string; url?: string; headers?: Record<string,string> }) {
  const url = init.url ?? "http://localhost:3000/api/test";
  const headersMap = new Map<string,string>(Object.entries(init.headers ?? {}));
  return {
    method: init.method ?? "POST",
    url,
    nextUrl: new URL(url),
    headers: {
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    },
  } as unknown as Parameters<typeof assertSameOrigin>[0];
}

describe("sanitizeNextPath", () => {
  it("allows safe relative next", () => {
    expect(sanitizeNextPath("/sell")).toBe("/sell");
    expect(sanitizeNextPath("/threads/123?foo=bar")).toBe("/threads/123?foo=bar");
    expect(sanitizeNextPath("/")).toBe("/");
  });
  it("rejects absolute, protocol, double slash, backslash", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/");
    expect(sanitizeNextPath("//evil.com")).toBe("/");
    expect(sanitizeNextPath("/\\evil")).toBe("/");
    expect(sanitizeNextPath("sell")).toBe("/");
    expect(sanitizeNextPath("")).toBe("/");
    expect(sanitizeNextPath(null)).toBe("/");
  });
  it("rejects encoded protocol", () => {
    expect(sanitizeNextPath("/%2F%2Fevil.com")).toBe("/");
  });
  it("rejects too long", () => {
    expect(sanitizeNextPath("/" + "a".repeat(600))).toBe("/");
  });
});

describe("assertSameOrigin", () => {
  it("passes for same origin", () => {
    const req = mockRequest({ method: "POST", url: "http://localhost:3000/api/listings", headers: { origin: "http://localhost:3000", host: "localhost:3000" } });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });
  it("fails for cross origin", () => {
    const req = mockRequest({ method: "POST", url: "http://localhost:3000/api/listings", headers: { origin: "https://evil.com", host: "localhost:3000" } });
    expect(() => assertSameOrigin(req)).toThrow(ApiProblem);
    try { assertSameOrigin(req); } catch (e) { expect((e as ApiProblem).code).toBe("csrf_rejected"); }
  });
  it("allows GET without origin", () => {
    const req = mockRequest({ method: "GET", url: "http://localhost:3000/api/listings", headers: { host: "localhost:3000" } });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });
  it("fails for POST missing origin/referer", () => {
    const req = mockRequest({ method: "POST", url: "http://localhost:3000/api/listings", headers: { host: "localhost:3000" } });
    expect(() => assertSameOrigin(req)).toThrow();
  });
  it("checks referer when origin missing", () => {
    const req = mockRequest({ method: "POST", url: "http://localhost:3000/api/listings", headers: { referer: "http://localhost:3000/sell", host: "localhost:3000" } });
    expect(() => assertSameOrigin(req)).not.toThrow();
    const bad = mockRequest({ method: "POST", url: "http://localhost:3000/api/listings", headers: { referer: "https://evil.com/", host: "localhost:3000" } });
    expect(() => assertSameOrigin(bad)).toThrow();
  });
});

describe("getAppMode", () => {
  const orig = process.env.APP_MODE;
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.APP_MODE = orig;
    process.env.SUPABASE_URL = origUrl;
    process.env.SUPABASE_PUBLISHABLE_KEY = origKey;
  });

  it("returns demo when APP_MODE=demo even with config", () => {
    process.env.APP_MODE = "demo";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "key";
    expect(getAppMode()).toBe("demo");
  });
  it("returns live when APP_MODE=live even without config", () => {
    process.env.APP_MODE = "live";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(getAppMode()).toBe("live");
  });
  it("chooses demo if no env and unspecified", () => {
    delete process.env.APP_MODE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(getAppMode()).toBe("demo");
  });
  it("chooses live if config present and unspecified", () => {
    delete process.env.APP_MODE;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "key";
    expect(getAppMode()).toBe("live");
  });
});

describe("validation schemas", () => {
  it("listingSchema rejects invalid image_path", () => {
    const parsed = imagePathSchema.safeParse("not-a-path");
    expect(parsed.success).toBe(false);
    const good = imagePathSchema.safeParse("11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg");
    expect(good.success).toBe(true);
  });
  it("listingSchema requires seller_confirmed true", () => {
    const base = { title: "Valid Title", description: "Valid description with more than ten characters.", price_inr: 100, category_id: "00000000-0000-4000-8000-000000000001", condition: "good" as const, hostel_block: "A Block", image_path: "11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.jpg", tags: [], seller_confirmed: true as const };
    expect(listingSchema.safeParse(base).success).toBe(true);
    // missing seller_confirmed
    const rest: Record<string, unknown> = { ...base }; delete rest.seller_confirmed;
    expect(listingSchema.safeParse(rest).success).toBe(false);
  });
  it("listingFiltersSchema validates sort and price bounds", () => {
    expect(listingFiltersSchema.safeParse({ sort: "newest", cursor: 0, limit: 12 }).success).toBe(true);
    expect(listingFiltersSchema.safeParse({ min_price: 500, max_price: 100 }).success).toBe(false);
    expect(listingFiltersSchema.safeParse({ q: "a".repeat(161) }).success).toBe(false);
  });
  it("profileSchema trims", () => {
    expect(profileSchema.safeParse({ display_name: "AB", hostel_block: null }).success).toBe(true);
    expect(profileSchema.safeParse({ display_name: "A", hostel_block: null }).success).toBe(false);
  });
  it("messageSchema bounds", () => {
    expect(messageSchema.safeParse({ body: "hello" }).success).toBe(true);
    expect(messageSchema.safeParse({ body: "" }).success).toBe(false);
    expect(messageSchema.safeParse({ body: "a".repeat(2001) }).success).toBe(false);
  });
  it("reportSchema", () => {
    expect(reportSchema.safeParse({ listing_id: "00000000-0000-4000-8000-000000000001", reason: "spam", details: "" }).success).toBe(true);
    expect(reportSchema.safeParse({ listing_id: "00000000-0000-4000-8000-000000000001", reason: "invalid", details: "" }).success).toBe(false);
  });
});

describe("demo data", () => {
  it("exports DEMO_LISTINGS and DEMO_PROFILES with correct CATEGORIES ids", () => {
    expect(Array.isArray(DEMO_LISTINGS)).toBe(true);
    expect(DEMO_LISTINGS.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_PROFILES.length).toBe(3);
    for (const l of DEMO_LISTINGS) {
      expect(CATEGORIES.some(c => c.id === l.category_id)).toBe(true);
      expect(l.image_path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i);
      expect(l.seller).toBeDefined();
    }
  });
  it("demo listings have safe public profile cols only", () => {
    for (const p of DEMO_PROFILES) {
      expect(p).not.toHaveProperty("email");
      expect(p.id).toMatch(/^[0-9a-f-]{8}-/);
    }
  });
});

describe("ApiProblem", () => {
  it("holds status, code, message, fields", () => {
    const err = new ApiProblem(403, "demo_readonly", "Demo readonly", { file: ["err"] });
    expect(err.status).toBe(403);
    expect(err.code).toBe("demo_readonly");
    expect(err.message).toBe("Demo readonly");
    expect(err.fields).toEqual({ file: ["err"] });
  });
});
