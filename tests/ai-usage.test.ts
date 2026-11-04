import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAiUsageSnapshot, type AiUsageDataSource } from "@/lib/ai/usage";
import { AiUsageRequestManager, nextUtcResetDelay, type AiUsage } from "@/lib/client/ai-usage";

const ENV_KEYS = ["APP_MODE", "AI_ENABLED", "AI_DAILY_LIMIT", "AI_USER_DAILY_LIMIT", "AI_OWNER_DAILY_LIMIT", "AI_OWNER_ALLOWLIST", "AI_TEST_MODE", "AI_DRAFT_PROVIDER", "META_API_KEY", "META_MODEL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function source(overrides: Partial<{ account: number; global: number; feature: number; accountFeature: number; featureLimit: number; featureUserLimit: number; cap: number; used: number; reserve: number; enabled: boolean }> = {}): AiUsageDataSource {
  const values = { account: 4, global: 4, feature: 4, accountFeature: 4, featureLimit: 50, featureUserLimit: 50, cap: 1_000_000, used: 0, reserve: 0, enabled: true, ...overrides };
  return {
    getBudget: async () => ({ enabled: values.enabled, daily_limit: 50, per_user_limit: 100, meta_micro_usd_cap: values.cap, meta_micro_usd_used: values.used, meta_reserve_micro_usd: values.reserve, baseten_micro_usd_cap: 1_000_000, baseten_micro_usd_used: 0, baseten_reserve_micro_usd: 0 }),
    getSettings: async () => ({ enabled: values.enabled, daily_limit: values.featureLimit, per_user_limit: values.featureUserLimit }),
    getPricebook: async (feature) => ({ provider: "meta", model: feature === "draft" ? "muse-spark-1.3" : feature === "transcribe" ? "muse-voice-transcribe-1.0" : "sam-3.1", max_cost_micro_usd: 10_000, enabled: values.enabled }),
    countAttempts: async (filters) => filters.userId && filters.feature ? values.accountFeature : filters.userId ? values.account : filters.feature ? values.feature : values.global,
  };
}

describe("account AI usage snapshot", () => {
  beforeEach(() => {
    process.env.AI_ENABLED = "true";
    process.env.APP_MODE = "live";
    process.env.AI_DAILY_LIMIT = "50";
    process.env.AI_USER_DAILY_LIMIT = "15";
    process.env.AI_OWNER_DAILY_LIMIT = "30";
    process.env.AI_OWNER_ALLOWLIST = "owner@example.com";
    process.env.AI_TEST_MODE = "false";
    process.env.AI_DRAFT_PROVIDER = "meta";
    process.env.META_API_KEY = "test-meta-key";
    process.env.META_MODEL = "muse-spark-1.3";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses real ordinary and owner account caps while counting all reserved attempts", async () => {
    const now = new Date("2026-11-04T17:30:00Z");
    await expect(readAiUsageSnapshot({ id: "ordinary", email: "ordinary@example.com" }, "draft", now, source())).resolves.toMatchObject({ feature: "draft", limit: 15, used: 4, remaining: 11, available: true, resets_at: "2026-11-05T00:00:00.000Z" });
    await expect(readAiUsageSnapshot({ id: "owner", email: "owner@example.com" }, "draft", now, source())).resolves.toMatchObject({ limit: 30, used: 4, remaining: 26, available: true });
  });

  it("applies feature caps to all shared and account attempts, matching reservation SQL", async () => {
    await expect(readAiUsageSnapshot({ id: "ordinary" }, "draft", new Date(), source({ account: 15, accountFeature: 1 }))).resolves.toMatchObject({ remaining: 0, available: false, unavailability: "account_limit" });
    await expect(readAiUsageSnapshot({ id: "ordinary" }, "draft", new Date(), source({ global: 50, feature: 1 }))).resolves.toMatchObject({ remaining: 11, available: false, unavailability: "shared_limit" });
    await expect(readAiUsageSnapshot({ id: "ordinary" }, "cutout", new Date(), source({ account: 6, accountFeature: 1, featureUserLimit: 6 }))).resolves.toMatchObject({ feature: "cutout", limit: 6, used: 6, remaining: 0, available: false, unavailability: "feature_limit" });
  });

  it("reports feature-specific provider availability without exposing money", async () => {
    const budgetLimited = await readAiUsageSnapshot({ id: "ordinary" }, "cutout", new Date(), source({ cap: 10_000, used: 1, reserve: 0 }));
    expect(budgetLimited).toMatchObject({ available: false, unavailability: "provider_budget" });
    expect(Object.keys(budgetLimited)).not.toContain("dollars");
  });

  it("fails instead of fabricating values when a ledger read fails", async () => {
    const failing = source();
    failing.countAttempts = async () => { throw new Error("database unavailable"); };
    await expect(readAiUsageSnapshot({ id: "ordinary" }, "draft", new Date(), failing)).rejects.toThrow("database unavailable");
  });
});

const usage = (ownerFeature: AiUsage["feature"] = "draft"): AiUsage => ({
  feature: ownerFeature,
  remaining: 9,
  limit: 15,
  used: 6,
  resets_at: "2026-11-05T00:00:00.000Z",
  available: true,
  unavailability: null,
});

describe("client AI usage request lifetime", () => {
  afterEach(() => vi.useRealTimers());

  it("calls a receiver-sensitive browser fetch with the global receiver", async () => {
    const fetcher = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ data: usage() }), { status: 200 }));
    }) as unknown as typeof fetch;
    const manager = new AiUsageRequestManager(fetcher);
    manager.setOwner("user");

    await expect(manager.load("user", "draft")).resolves.toEqual({ status: "success", owner: "user", usage: usage() });
    expect(fetcher).toHaveBeenCalledWith("/api/ai/usage?feature=draft", expect.objectContaining({ cache: "no-store" }));
  });

  it("does not let a late previous-account response restore stale usage", async () => {
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFirst = resolve; })) as unknown as typeof fetch;
    const manager = new AiUsageRequestManager(fetcher);
    manager.setOwner("first-user");
    const first = manager.load("first-user", "draft");
    manager.setOwner("second-user");
    resolveFirst(new Response(JSON.stringify({ data: usage() }), { status: 200 }));
    await expect(first).resolves.toEqual({ status: "stale" });
    await expect(manager.load("first-user", "draft")).resolves.toEqual({ status: "stale" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("invalidates late work on logout and unmount", async () => {
    let resolveRequest!: (value: Response) => void;
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      resolveRequest = resolve;
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    const manager = new AiUsageRequestManager(fetcher);
    manager.setOwner("user");
    const pending = manager.load("user", "draft");
    manager.setOwner(null);
    resolveRequest(new Response(JSON.stringify({ data: usage() }), { status: 200 }));
    await expect(pending).resolves.toEqual({ status: "stale" });

    manager.setOwner("user");
    const unmounted = manager.load("user", "draft");
    manager.dispose();
    await expect(unmounted).resolves.toEqual({ status: "stale" });
  });

  it("aborts a bounded fetch and schedules the next UTC reset", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
    const manager = new AiUsageRequestManager(fetcher, 100);
    manager.setOwner("user");
    const pending = manager.load("user", "cutout");
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toEqual({ status: "error", owner: "user" });
    expect(nextUtcResetDelay(new Date("2026-11-04T23:59:59.500Z"))).toBe(1_500);
  });
});
