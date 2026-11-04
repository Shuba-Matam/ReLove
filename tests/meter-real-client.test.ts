import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { MeterCompletionError, meterCompleteChecked, readMeterCompletion } from "@/lib/ai/meter";

const userId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const result = { status: "done", source_image_path: `${userId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`, cutout_path: `${userId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg` };

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function actualClient(fetchImpl: typeof fetch) {
  return createClient("https://example.supabase.co", "service-role-test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("meter completion with actual Supabase client", () => {
  it("keeps method binding and reads a late done operation after a lost RPC reply", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rpc/complete_ai_attempt")) throw new TypeError("Failed to fetch");
      if (url.includes("/ai_attempts?")) return jsonResponse([{ id: attemptId, operation_id: operationId, user_id: userId, ok: true, completed_at: "2026-11-04T00:00:00Z" }]);
      if (url.includes("/ai_operations?")) return jsonResponse([{ id: operationId, user_id: userId, feature: "cutout", status: "done", result }]);
      throw new Error(`unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const client = actualClient(fetchImpl);
    await expect(meterCompleteChecked({ client, userId, attemptId, ok: true, ms: 10, result })).rejects.toBeInstanceOf(MeterCompletionError);
    await expect(readMeterCompletion({ client, userId, attemptId, operationId, timeoutMs: 1000 })).resolves.toEqual({ state: "done", result });
  });

  it.each([
    ["pending", null, null, "pending"],
    ["failed", false, "2026-11-04T00:00:00Z", "failed"],
  ] as const)("reads authoritative %s state through the real PostgREST builder", async (operationStatus, ok, completedAt, expected) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ai_attempts?")) return jsonResponse([{ id: attemptId, operation_id: operationId, user_id: userId, ok, completed_at: completedAt }]);
      if (url.includes("/ai_operations?")) return jsonResponse([{ id: operationId, user_id: userId, feature: "cutout", status: operationStatus, result: null }]);
      throw new Error(`unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const client = actualClient(fetchImpl);
    await expect(readMeterCompletion({ client, userId, attemptId, operationId, timeoutMs: 1000 })).resolves.toMatchObject({ state: expected });
  });
});
