import "server-only";
import { z } from "zod";
import { aiLimitCap, assertOwnerTestGate, getAiUserDailyLimit, type AiFeature } from "./context";
import { createMeteringClient } from "./meter";
import { getAiFeatureAvailability, getFeatureProviderModel } from "@/lib/server/env";

const budgetSchema = z.object({
  enabled: z.boolean(),
  daily_limit: z.coerce.number().int().nonnegative(),
  per_user_limit: z.coerce.number().int().nonnegative(),
  meta_micro_usd_cap: z.coerce.number().int().nonnegative().nullable(),
  meta_micro_usd_used: z.coerce.number().int().nonnegative(),
  meta_reserve_micro_usd: z.coerce.number().int().nonnegative(),
  baseten_micro_usd_cap: z.coerce.number().int().nonnegative().nullable(),
  baseten_micro_usd_used: z.coerce.number().int().nonnegative(),
  baseten_reserve_micro_usd: z.coerce.number().int().nonnegative(),
});

const settingsSchema = z.object({
  enabled: z.boolean(),
  daily_limit: z.coerce.number().int().nonnegative(),
  per_user_limit: z.coerce.number().int().nonnegative(),
});

const pricebookSchema = z.object({
  provider: z.enum(["meta", "baseten"]),
  model: z.string().min(1),
  max_cost_micro_usd: z.coerce.number().int().positive(),
  enabled: z.boolean(),
});

export type AiUsageDataSource = {
  getBudget: () => Promise<unknown>;
  getSettings: (feature: AiFeature) => Promise<unknown>;
  getPricebook: (feature: AiFeature) => Promise<unknown>;
  countAttempts: (filters: { since: string; userId?: string; feature?: AiFeature }) => Promise<number>;
};

export type AiUsageSnapshot = {
  feature: AiFeature;
  remaining: number;
  limit: number;
  used: number;
  resets_at: string;
  available: boolean;
  unavailability: "account_limit" | "shared_limit" | "feature_limit" | "provider_budget" | "disabled" | null;
};

function nextUtcReset(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function createSupabaseUsageDataSource(client: NonNullable<ReturnType<typeof createMeteringClient>>): AiUsageDataSource {
  return {
    async getBudget() {
      const { data, error } = await client.from("ai_budget").select("enabled,daily_limit,per_user_limit,meta_micro_usd_cap,meta_micro_usd_used,meta_reserve_micro_usd,baseten_micro_usd_cap,baseten_micro_usd_used,baseten_reserve_micro_usd").eq("id", true).maybeSingle();
      if (error || !data) throw new Error("AI_USAGE_UNAVAILABLE");
      return data;
    },
    async getSettings(feature) {
      const { data, error } = await client.from("ai_settings").select("enabled,daily_limit,per_user_limit").eq("feature", feature).maybeSingle();
      if (error || !data) throw new Error("AI_USAGE_UNAVAILABLE");
      return data;
    },
    async getPricebook(feature) {
      const { data, error } = await client.from("ai_pricebook").select("provider,model,max_cost_micro_usd,enabled").eq("feature", feature).maybeSingle();
      if (error || !data) throw new Error("AI_USAGE_UNAVAILABLE");
      return data;
    },
    async countAttempts(filters) {
      let query = client.from("ai_attempts").select("id", { count: "exact", head: true }).gte("created_at", filters.since);
      if (filters.userId) query = query.eq("user_id", filters.userId);
      if (filters.feature) query = query.eq("feature", filters.feature);
      const { count, error } = await query;
      if (error || count === null) throw new Error("AI_USAGE_UNAVAILABLE");
      return count;
    },
  };
}

export async function readAiUsageSnapshot(user: { id: string; email?: string | null }, feature: AiFeature = "draft", now = new Date(), dataSource?: AiUsageDataSource): Promise<AiUsageSnapshot> {
  if (process.env.AI_ENABLED !== "true" || !getAiFeatureAvailability()[feature]) {
    return { feature, remaining: 0, limit: 0, used: 0, resets_at: nextUtcReset(now), available: false, unavailability: "disabled" };
  }
  assertOwnerTestGate(user);
  const client = createMeteringClient();
  if (!dataSource && !client) throw new Error("AI_USAGE_UNAVAILABLE");
  const source = dataSource ?? createSupabaseUsageDataSource(client!);
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

  const [budgetRaw, settingsRaw, pricebookRaw, globalUsed, accountUsed, featureUsed, accountFeatureUsed] = await Promise.all([
    source.getBudget(),
    source.getSettings(feature),
    source.getPricebook(feature),
    source.countAttempts({ since }),
    source.countAttempts({ since, userId: user.id }),
    source.countAttempts({ since, feature }),
    source.countAttempts({ since, userId: user.id, feature }),
  ]);
  const budget = budgetSchema.parse(budgetRaw);
  const settings = settingsSchema.parse(settingsRaw);
  const pricebook = pricebookSchema.parse(pricebookRaw);
  const envDaily = aiLimitCap("AI_DAILY_LIMIT", 50);
  const envAccount = getAiUserDailyLimit(user);
  const accountLimit = Math.min(envAccount, budget.per_user_limit, settings.per_user_limit);
  const sharedLimit = Math.min(envDaily, budget.daily_limit, settings.daily_limit);
  const featureLimit = settings.daily_limit;
  const accountFeatureLimit = settings.per_user_limit;
  const remaining = Math.max(0, accountLimit - accountUsed);
  const featureSetsSharedLimit = settings.daily_limit < Math.min(envDaily, budget.daily_limit);
  const featureSetsAccountLimit = settings.per_user_limit < Math.min(envAccount, budget.per_user_limit);

  let unavailability: AiUsageSnapshot["unavailability"] = null;
  if (!budget.enabled || !settings.enabled || !pricebook.enabled || !envDaily || !envAccount) unavailability = "disabled";
  else if (accountUsed >= accountLimit) unavailability = featureSetsAccountLimit ? "feature_limit" : "account_limit";
  else if (globalUsed >= sharedLimit) unavailability = featureSetsSharedLimit ? "feature_limit" : "shared_limit";
  else if (featureUsed >= featureLimit || accountFeatureUsed >= accountFeatureLimit) unavailability = "feature_limit";
  else {
    const expected = getFeatureProviderModel(feature);
    const providerMatches = pricebook.provider === expected.provider && pricebook.model === expected.model;
    const cap = pricebook.provider === "meta" ? budget.meta_micro_usd_cap : budget.baseten_micro_usd_cap;
    const used = pricebook.provider === "meta" ? budget.meta_micro_usd_used : budget.baseten_micro_usd_used;
    const reserve = pricebook.provider === "meta" ? budget.meta_reserve_micro_usd : budget.baseten_reserve_micro_usd;
    if (!providerMatches || cap === null || cap <= 0 || reserve > cap || used + pricebook.max_cost_micro_usd > cap - reserve) unavailability = "provider_budget";
  }

  return {
    feature,
    remaining,
    limit: accountLimit,
    used: accountUsed,
    resets_at: nextUtcReset(now),
    available: unavailability === null && remaining > 0,
    unavailability,
  };
}
