import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAiUsageSnapshot, type AiUsageDataSource } from "@/lib/ai/usage";

const ENV_KEYS = ["APP_MODE", "AI_ENABLED", "AI_DAILY_LIMIT", "AI_USER_DAILY_LIMIT", "AI_OWNER_DAILY_LIMIT", "AI_OWNER_ALLOWLIST", "AI_TEST_MODE", "AI_DRAFT_PROVIDER", "META_API_KEY", "META_MODEL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function source(overrides: Partial<{ account: number; global: number; feature: number; accountFeature: number; featureLimit: number; featureUserLimit: number; cap: number; used: number; reserve: number; enabled: boolean }> = {}): AiUsageDataSource {
  const values = { account: 4, global: 4, feature: 4, accountFeature: 4, featureLimit: 50, featureUserLimit: 50, cap: 1_000_000, used: 0, reserve: 0, enabled: true, ...overrides };
  return {
    getBudget: async () => ({ enabled: values.enabled, daily_limit: 50, per_user_limit: 100, meta_micro_usd_cap: values.cap, meta_micro_usd_used: values.used, meta_reserve_micro_usd: values.reserve, baseten_micro_usd_cap: 1_000_000, baseten_micro_usd_used: 0, baseten_reserve_micro_usd: 0 }),
    getSettings: async () => ({ enabled: values.enabled, daily_limit: values.featureLimit, per_user_limit: values.featureUserLimit }),
    getPricebook: async () => ({ provider: "meta", model: "muse-spark-1.3", max_cost_micro_usd: 10_000, enabled: values.enabled }),
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
    await expect(readAiUsageSnapshot({ id: "ordinary", email: "ordinary@example.com" }, now, source())).resolves.toMatchObject({ limit: 15, used: 4, remaining: 11, available: true, resets_at: "2026-11-05T00:00:00.000Z" });
    await expect(readAiUsageSnapshot({ id: "owner", email: "owner@example.com" }, now, source())).resolves.toMatchObject({ limit: 30, used: 4, remaining: 26, available: true });
  });

  it("reports account, shared, feature, and provider-budget restrictions without exposing money", async () => {
    await expect(readAiUsageSnapshot({ id: "ordinary" }, new Date(), source({ account: 15, accountFeature: 15 }))).resolves.toMatchObject({ remaining: 0, available: false, unavailability: "account_limit" });
    await expect(readAiUsageSnapshot({ id: "ordinary" }, new Date(), source({ global: 50 }))).resolves.toMatchObject({ remaining: 11, available: false, unavailability: "shared_limit" });
    await expect(readAiUsageSnapshot({ id: "ordinary" }, new Date(), source({ feature: 5, featureLimit: 5 }))).resolves.toMatchObject({ available: false, unavailability: "feature_limit" });
    const budgetLimited = await readAiUsageSnapshot({ id: "ordinary" }, new Date(), source({ cap: 10_000, used: 1, reserve: 0 }));
    expect(budgetLimited).toMatchObject({ available: false, unavailability: "provider_budget" });
    expect(Object.keys(budgetLimited)).not.toContain("dollars");
  });

  it("fails instead of fabricating values when a ledger read fails", async () => {
    const failing = source();
    failing.countAttempts = async () => { throw new Error("database unavailable"); };
    await expect(readAiUsageSnapshot({ id: "ordinary" }, new Date(), failing)).rejects.toThrow("database unavailable");
  });
});
