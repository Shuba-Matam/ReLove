import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiFeature } from "./context";

export function hashSource(input: string | object): string {
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha256").update(raw).digest("hex");
}

/** Server-only metering client (service_role). Missing credential fails closed; no fallback. */
export function createMeteringClient() {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input as string, { ...(init as RequestInit), signal: (init as RequestInit)?.signal ?? AbortSignal.timeout(10000) }) },
  });
}

export function getMeteringSetupState(): { hasServiceKey: boolean; ready: boolean } {
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  return { hasServiceKey, ready: hasServiceKey };
}

export type MeterReserveResult = {
  operationId: string | null;
  attemptId: string | null;
  allowed: boolean;
  disposition: "executed" | "duplicate_done" | "duplicate_pending" | "rejected";
  reason: string | null;
  cachedResult: unknown | null;
};

const reserveRowSchema = z.object({
  operation_id: z.string().uuid().nullable(),
  attempt_id: z.string().uuid().nullable(),
  allowed: z.boolean(),
  disposition: z.enum(["executed", "duplicate_done", "duplicate_pending", "rejected"]),
  reason: z.string().nullable(),
  cached_result: z.unknown().nullable(),
});

const RESERVE_TIMEOUT_MS = 4000;
const COMPLETE_TIMEOUT_MS = 2500;

export class MeterCompletionError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "MeterCompletionError";
  }
}

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
  expectedVersion?: number | null;
  expectedFingerprint?: string | null;
};

export function pricebookFingerprint(row: PricebookRow): string {
  const payload = [row.feature, row.provider, row.model, String(row.max_cost_micro_usd), row.input_max_chars?.toString() ?? "", row.output_max_tokens?.toString() ?? "", row.max_duration_sec?.toString() ?? "", String(row.enabled), String(row.version ?? 1)].join("|");
  return createHash("md5").update(payload).digest("hex");
}

export async function meterReserve(args: ReserveMeterArgs): Promise<MeterReserveResult> {
  if (!args.client) throw new Error("AI_METERING_UNAVAILABLE");
  const params: Record<string, unknown> = {
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
  if (args.expectedVersion !== undefined && args.expectedVersion !== null) params.p_expected_version = args.expectedVersion;
  if (args.expectedFingerprint !== undefined && args.expectedFingerprint !== null) params.p_expected_fingerprint = args.expectedFingerprint;
  const raw = await withTimeout(
    (args.client.rpc as unknown as (fn: string, p: unknown) => Promise<{ data: unknown; error: unknown }>)("reserve_ai_attempt", params),
    RESERVE_TIMEOUT_MS,
    "AI_RESERVE_TIMEOUT"
  );
  const { data, error } = raw as { data: unknown; error: { message?: string } | null };
  if (error) {
    const msg = error.message ?? String(error);
    if (msg.includes("reserve_ai_attempt") || msg.includes("does not exist") || msg.includes("permission denied")) {
      throw new Error("AI_METERING_UNAVAILABLE:" + msg);
    }
    throw new Error("AI_METERING_ERROR:" + msg);
  }
  const rowRaw = Array.isArray(data) ? (data as unknown[])[0] as Record<string, unknown> : (data as Record<string, unknown>);
  if (!rowRaw) throw new Error("AI_METERING_EMPTY");
  const parsed = reserveRowSchema.safeParse(rowRaw);
  if (!parsed.success) throw new Error("AI_METERING_MALFORMED:" + parsed.error.message);
  const row = parsed.data;
  // Fresh allowed must have attemptId+operationId and known disposition executed
  if (row.allowed) {
    if (!row.attempt_id || !row.operation_id || row.disposition !== "executed") {
      throw new Error("AI_METERING_MALFORMED: fresh allowed must have attempt_id+operation_id+executed");
    }
  } else {
    // For duplicate_done, cached_result may be present; for pending/rejected, attempt_id must be null
    if (row.disposition === "duplicate_done" || row.disposition === "duplicate_pending") {
      if (row.attempt_id !== null) throw new Error("AI_METERING_MALFORMED: duplicate must not have attempt_id");
    }
  }
  return {
    operationId: row.operation_id,
    attemptId: row.attempt_id,
    allowed: row.allowed,
    disposition: row.disposition,
    reason: row.reason,
    cachedResult: row.cached_result,
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
  await bounded.catch(() => undefined);
}

/** Completion variant for flows that must not expose a derived artifact until the ledger is durably done. */
export async function meterCompleteChecked(args: {
  client: ReturnType<typeof createMeteringClient>;
  userId: string;
  attemptId: string;
  ok: boolean;
  ms: number;
  result?: unknown;
}): Promise<void> {
  if (!args.client || !args.attemptId) throw new MeterCompletionError("AI_COMPLETE_UNAVAILABLE");
  let response: { error: unknown };
  try {
    response = await withTimeout(
      (args.client.rpc as unknown as (fn: string, p: unknown) => Promise<{ error: unknown }>)('complete_ai_attempt', {
        p_user_id: args.userId,
        p_attempt_id: args.attemptId,
        p_ok: args.ok,
        p_ms: Math.max(0, Math.min(60000, Math.round(args.ms))),
        p_result: args.result ?? null,
      }),
      COMPLETE_TIMEOUT_MS,
      "AI_COMPLETE_TIMEOUT",
    );
  } catch {
    // Timeout/transport rejection is uncertain: the uncancelled RPC may commit later.
    throw new MeterCompletionError("AI_COMPLETE_UNCERTAIN");
  }
  // PostgREST resolves transport failures as { error, status: 0 }, and even an
  // ordinary error response can race a commit. Every completion error requires read-back.
  if (response.error) throw new MeterCompletionError("AI_COMPLETE_UNCERTAIN");
}

export type MeterCompletionState = {
  state: "done" | "failed" | "pending" | "indeterminate";
  result: unknown | null;
};

/** Read back the exact attempt and operation after an uncertain completion outcome. */
export async function readMeterCompletion(args: {
  client: ReturnType<typeof createMeteringClient>;
  userId: string;
  attemptId: string;
  operationId: string;
  timeoutMs?: number;
}): Promise<MeterCompletionState> {
  if (!args.client) return { state: "indeterminate", result: null };
  type Query = { select: (columns: string) => Query; eq: (column: string, value: string) => Query; maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
  try {
    // Keep the Supabase method bound to its client; detached `from` loses `this.rest`.
    const [attemptResponse, operationResponse] = await withTimeout(Promise.all([
      (args.client.from("ai_attempts") as unknown as Query).select("id,operation_id,user_id,ok,completed_at").eq("id", args.attemptId).eq("user_id", args.userId).maybeSingle(),
      (args.client.from("ai_operations") as unknown as Query).select("id,user_id,feature,status,result").eq("id", args.operationId).eq("user_id", args.userId).eq("feature", "cutout").maybeSingle(),
    ]), Math.max(1, Math.min(2500, args.timeoutMs ?? 1200)), "AI_COMPLETE_READBACK_TIMEOUT");
    if (attemptResponse.error || operationResponse.error || !attemptResponse.data || !operationResponse.data) return { state: "indeterminate", result: null };
    const attempt = z.object({
      id: z.string().uuid(), operation_id: z.string().uuid(), user_id: z.string().uuid(), ok: z.boolean().nullable(), completed_at: z.union([z.string(), z.date()]).nullable(),
    }).safeParse(attemptResponse.data);
    const operation = z.object({
      id: z.string().uuid(), user_id: z.string().uuid(), feature: z.literal("cutout"), status: z.enum(["pending", "done", "failed"]), result: z.unknown().nullable(),
    }).safeParse(operationResponse.data);
    if (!attempt.success || !operation.success || attempt.data.operation_id !== operation.data.id || operation.data.id !== args.operationId) {
      return { state: "indeterminate", result: null };
    }
    if (attempt.data.completed_at && attempt.data.ok === true && operation.data.status === "done") return { state: "done", result: operation.data.result };
    if (attempt.data.completed_at && attempt.data.ok === false && operation.data.status === "failed") return { state: "failed", result: operation.data.result };
    return { state: "pending", result: operation.data.result };
  } catch {
    return { state: "indeterminate", result: null };
  }
}

export const pricebookRowSchema = z.object({
  feature: z.string(),
  provider: z.string(),
  model: z.string(),
  max_cost_micro_usd: z.coerce.number().int().positive(),
  enabled: z.boolean(),
  input_max_chars: z.coerce.number().int().positive().nullable(),
  output_max_tokens: z.coerce.number().int().positive().nullable(),
  max_duration_sec: z.coerce.number().int().positive().nullable(),
  version: z.coerce.number().int().positive().nullable().optional(),
  updated_at: z.union([z.string(), z.date()]).nullable().optional(),
});
export type PricebookRow = z.infer<typeof pricebookRowSchema>;

export async function fetchPricebookRow(client: NonNullable<ReturnType<typeof createMeteringClient>>, feature: AiFeature): Promise<PricebookRow | null> {
  const { data, error } = await (client.from as unknown as (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } })("ai_pricebook")
    .select("feature,provider,model,max_cost_micro_usd,enabled,input_max_chars,output_max_tokens,max_duration_sec,version,updated_at")
    .eq("feature", feature)
    .maybeSingle();
  if (error) throw new Error("AI_METERING_UNAVAILABLE:" + String(error));
  if (!data) return null;
  const parsed = pricebookRowSchema.safeParse(data);
  if (!parsed.success) throw new Error("AI_METERING_MALFORMED: pricebook row invalid");
  return parsed.data;
}

export function enforcePricebookBounds(
  row: PricebookRow | null,
  dimensions: { inputChars?: number; outputTokens?: number; audioDurationSec?: number; imageBytes?: number; imageWidth?: number; imageHeight?: number },
  providerLimits: { maxImageBytes: number; maxAudioBytes: number; maxOutputTokens: number; maxImageSide: number }
): void {
  if (!row || !row.enabled) {
    // Empty/unverified pricebook disables: no guessed production rows
    throw new Error("AI_PRICEBOOK_UNAVAILABLE");
  }
  // Input chars check: conservative upper bound includes transcript+prompt
  if (row.input_max_chars !== null && dimensions.inputChars !== undefined && dimensions.inputChars > row.input_max_chars) {
    throw new Error("AI_BOUNDS_EXCEEDED:input_chars");
  }
  if (row.output_max_tokens !== null && dimensions.outputTokens !== undefined && dimensions.outputTokens > row.output_max_tokens) {
    throw new Error("AI_BOUNDS_EXCEEDED:output_tokens");
  }
  if (row.max_duration_sec !== null && dimensions.audioDurationSec !== undefined && dimensions.audioDurationSec > row.max_duration_sec) {
    throw new Error("AI_BOUNDS_EXCEEDED:duration");
  }
  // Also enforce provider hard bounds regardless of pricebook
  if (dimensions.imageBytes !== undefined && dimensions.imageBytes > providerLimits.maxImageBytes) {
    throw new Error("AI_BOUNDS_EXCEEDED:image_bytes");
  }
  if (dimensions.audioDurationSec !== undefined && dimensions.audioDurationSec > 60) {
    throw new Error("AI_BOUNDS_EXCEEDED:audio_duration");
  }
  if (dimensions.imageWidth !== undefined && dimensions.imageHeight !== undefined) {
    if (dimensions.imageWidth > providerLimits.maxImageSide || dimensions.imageHeight > providerLimits.maxImageSide) {
      throw new Error("AI_BOUNDS_EXCEEDED:image_dimensions");
    }
  }
}

// Conservative ceiling: pricebook max_cost_micro_usd is the trusted worst-case ceiling for all permitted input+output within bounds.
// Do NOT claim exact USD guarantee when upstream rates/bounds not verified; this is a bounded test fixture, not live activation config.
