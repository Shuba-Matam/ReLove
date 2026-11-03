import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { AiFeature } from "./context";

/** Hard-budget mode: when true, monetary caps via service_role metering RPCs are required. Off by default. */
export function isHardBudgetMode(): boolean {
  return process.env.AI_HARD_BUDGET === "true";
}

export function getMeteringEnvName(): string {
  return "SUPABASE_SERVICE_ROLE_KEY";
}

export function getMeteringSetupState(): { hardBudget: boolean; hasServiceKey: boolean; ready: boolean } {
  const hardBudget = isHardBudgetMode();
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  return { hardBudget, hasServiceKey, ready: hardBudget ? hasServiceKey : true };
}

export function hashSource(input: string | object): string {
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(raw).digest("hex");
}

/** Server-only metering client (service_role). Missing credential fails closed; no fallback. */
export function createMeteringClient() {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceKey) return null;
  // confined to budget client only; marketplace CRUD still uses publishable key via createSupabaseServerClient
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input as string, { ...(init as RequestInit), signal: (init as RequestInit)?.signal ?? AbortSignal.timeout(10000) }) },
  });
}

export type MeterReserveResult = {
  operationId: string | null;
  attemptId: string | null;
  allowed: boolean;
  disposition: "executed" | "duplicate_done" | "duplicate_pending" | "rejected";
  reason: string | null;
  cachedResult: unknown | null;
};

const RESERVE_TIMEOUT_MS = 4000;
const COMPLETE_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export type ReserveMeterArgs = {
  client: ReturnType<typeof createMeteringClient>;
  userId: string;
  feature: AiFeature;
  provider: string;
  model: string;
  idempotencyKey: string;
  sourceHash: string;
  dailyLimit: number;
  userLimit: number;
  listingId?: string | null;
};

export async function meterReserve(args: ReserveMeterArgs): Promise<MeterReserveResult> {
  if (!args.client) throw new Error("AI_METERING_UNAVAILABLE");
  const params = {
    p_user_id: args.userId,
    p_feature: args.feature,
    p_idempotency_key: args.idempotencyKey,
    p_provider: args.provider,
    p_model: args.model,
    p_source_hash: args.sourceHash,
    p_daily_limit: args.dailyLimit,
    p_user_limit: args.userLimit,
    p_listing_id: args.listingId ?? null,
  };
  // bounded wait
  const raw = await withTimeout(
    (args.client.rpc as unknown as (fn: string, p: unknown) => Promise<{ data: unknown; error: unknown }>)("reserve_ai_attempt", params),
    RESERVE_TIMEOUT_MS,
    "AI_RESERVE_TIMEOUT"
  );
  const { data, error } = raw as { data: unknown; error: { message?: string } | null };
  if (error) {
    const msg = error.message ?? String(error);
    // missing function / candidate not applied => fail closed, no fallback
    if (msg.includes("reserve_ai_attempt") || msg.includes("does not exist") || msg.includes("permission denied")) {
      throw new Error("AI_METERING_UNAVAILABLE:" + msg);
    }
    throw new Error("AI_METERING_ERROR:" + msg);
  }
  const row = Array.isArray(data) ? (data as unknown[])[0] as Record<string, unknown> : (data as Record<string, unknown>);
  if (!row) throw new Error("AI_METERING_EMPTY");
  return {
    operationId: (row.operation_id as string) ?? null,
    attemptId: (row.attempt_id as string) ?? null,
    allowed: row.allowed === true,
    disposition: (row.disposition as MeterReserveResult["disposition"]) ?? (row.allowed === true ? "executed" : "rejected"),
    reason: (row.reason as string) ?? null,
    cachedResult: (row.cached_result as unknown) ?? null,
  };
}

export async function meterComplete(args: {
  client: ReturnType<typeof createMeteringClient>;
  userId: string;
  attemptId: string;
  ok: boolean;
  ms: number;
  result?: unknown;
}): Promise<void> {
  if (!args.client || !args.attemptId) return;
  const bounded = withTimeout(
    (args.client.rpc as unknown as (fn: string, p: unknown) => Promise<{ error: unknown }>)("complete_ai_attempt", {
      p_user_id: args.userId,
      p_attempt_id: args.attemptId,
      p_ok: args.ok,
      p_ms: Math.max(0, Math.min(60000, Math.round(args.ms))),
      p_result: args.result ?? null,
    }),
    COMPLETE_TIMEOUT_MS,
    "AI_COMPLETE_TIMEOUT"
  );
  // bounded: if hang, do not block caller; swallow timeout
  await bounded.catch(() => undefined);
}
