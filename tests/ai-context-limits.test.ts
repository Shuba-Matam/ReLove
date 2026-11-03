import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/ai/meter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/meter")>("@/lib/ai/meter");
  return {
    ...actual,
    createMeteringClient: vi.fn(),
    fetchPricebookRow: vi.fn(),
  };
});

const ENV_KEYS = [
  "AI_ENABLED",
  "AI_DAILY_LIMIT",
  "AI_USER_DAILY_LIMIT",
  "AI_OWNER_DAILY_LIMIT",
  "AI_OWNER_ALLOWLIST",
  "AI_TEST_MODE",
  "AI_DRAFT_PROVIDER",
  "META_API_KEY",
  "META_MODEL",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

async function setAuthenticatedUser(user: { id: string; email?: string | null }) {
  const { requireUser } = await import("@/lib/server/auth");
  vi.mocked(requireUser).mockResolvedValue({ user, supabase: {} as never });
}

describe("requireAiContext user limits", () => {
  beforeEach(async () => {
    process.env.AI_ENABLED = "true";
    process.env.AI_DAILY_LIMIT = "60";
    process.env.AI_USER_DAILY_LIMIT = "15";
    process.env.AI_OWNER_DAILY_LIMIT = "30";
    process.env.AI_OWNER_ALLOWLIST = "owner@example.com owner-id";
    process.env.AI_TEST_MODE = "false";
    process.env.AI_DRAFT_PROVIDER = "meta";
    process.env.META_API_KEY = "test-meta-key";
    process.env.META_MODEL = "muse-spark-1.3";

    const { createMeteringClient, fetchPricebookRow } = await import("@/lib/ai/meter");
    vi.mocked(createMeteringClient).mockReturnValue({} as never);
    vi.mocked(fetchPricebookRow).mockResolvedValue({
      feature: "draft",
      provider: "meta",
      model: "muse-spark-1.3",
      max_cost_micro_usd: 10_000,
      enabled: true,
      input_max_chars: 8_000,
      output_max_tokens: 1_200,
      max_duration_sec: null,
      version: 1,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("supplies 15 for an ordinary verified user with test mode disabled", async () => {
    await setAuthenticatedUser({ id: "ordinary-id", email: "ordinary@example.com" });
    const { requireAiContext } = await import("@/lib/ai/context");

    const context = await requireAiContext("draft");

    expect(context.userLimit).toBe(15);
  });

  it("supplies 30 for an allowlisted owner with test mode disabled", async () => {
    await setAuthenticatedUser({ id: "owner-id", email: "owner@example.com" });
    const { requireAiContext } = await import("@/lib/ai/context");

    const context = await requireAiContext("draft");

    expect(context.userLimit).toBe(30);
  });

  it("falls back to the regular limit when the owner override is absent", async () => {
    delete process.env.AI_OWNER_DAILY_LIMIT;
    await setAuthenticatedUser({ id: "owner-id", email: "owner@example.com" });
    const { requireAiContext } = await import("@/lib/ai/context");

    const context = await requireAiContext("draft");

    expect(context.userLimit).toBe(15);
  });

  it("fails closed for an owner when the owner cap is invalid", async () => {
    process.env.AI_OWNER_DAILY_LIMIT = "1001";
    await setAuthenticatedUser({ id: "owner-id", email: "owner@example.com" });
    const { requireAiContext } = await import("@/lib/ai/context");
    const { createMeteringClient } = await import("@/lib/ai/meter");

    await expect(requireAiContext("draft")).rejects.toMatchObject({ status: 503, code: "AI_DISABLED" });
    expect(createMeteringClient).not.toHaveBeenCalled();
  });

  it("ignores client-shaped limit overrides and uses authenticated identity", async () => {
    await setAuthenticatedUser({ id: "ordinary-id", email: "ordinary@example.com" });
    const { requireAiContext } = await import("@/lib/ai/context");

    const context = await requireAiContext("draft", { userLimit: 999, owner: true } as never);

    expect(context.userLimit).toBe(15);
  });
});
