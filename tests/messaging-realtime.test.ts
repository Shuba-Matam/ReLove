import { describe, expect, it, vi } from "vitest";
import { MessagingRealtimeController } from "@/lib/client/messaging-realtime";

const alice = "11111111-1111-4111-8111-111111111111";

function bootstrap(token: string, expiresAt = Math.floor(Date.now() / 1000) + 120) {
  return new Response(JSON.stringify({ data: { url: "https://example.supabase.co", publishableKey: "key", accessToken: token, expiresAt, userId: alice } }), { status: 200 });
}

function realtimeHarness() {
  let callback: ((state: string) => void) | null = null;
  let change: ((payload: { new: unknown }) => void) | null = null;
  const channel = {
    on: vi.fn((_type: string, _filter: unknown, handler: (payload: { new: unknown }) => void) => { change = handler; return channel; }),
    subscribe: vi.fn((handler: (state: string) => void) => { callback = handler; return channel; }),
  };
  const client = {
    realtime: { setAuth: vi.fn(async () => undefined), disconnect: vi.fn() },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };
  return { client, subscribed: (state: string) => callback?.(state), changed: (row: unknown) => change?.({ new: row }) };
}

describe("MessagingRealtimeController", () => {
  it("renews a connected token and applies it before continuing", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValueOnce(bootstrap("one", Math.floor(Date.now() / 1000) + 61)).mockResolvedValueOnce(bootstrap("two"));
    const realtime = realtimeHarness();
    const controller = new MessagingRealtimeController({ fetchFn, createClientFn: vi.fn(() => realtime.client) as never });
    await controller.connect(alice);
    realtime.subscribed("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(realtime.client.realtime.setAuth).toHaveBeenNthCalledWith(2, "two");
    controller.disconnect();
    vi.useRealTimers();
  });

  it("recovers after the first bootstrap failure", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(bootstrap("ok"));
    const realtime = realtimeHarness();
    const controller = new MessagingRealtimeController({ fetchFn, createClientFn: vi.fn(() => realtime.client) as never });
    const statuses: string[] = [];
    controller.subscribe((event) => { if (event.kind === "connection") statuses.push(event.status); });
    await controller.connect(alice);
    expect(statuses).toContain("disconnected");
    await vi.advanceTimersByTimeAsync(1_000);
    realtime.subscribed("SUBSCRIBED");
    expect(statuses.at(-1)).toBe("connected");
    controller.disconnect();
    vi.useRealTimers();
  });

  it("emits connected catchup on reconnect and drops late account events", async () => {
    const fetchFn = vi.fn(async () => bootstrap("ok"));
    const first = realtimeHarness();
    const second = realtimeHarness();
    const createClientFn = vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client);
    const controller = new MessagingRealtimeController({ fetchFn, createClientFn });
    const events: string[] = [];
    controller.subscribe((event) => events.push(event.kind === "connection" ? event.status : event.message.id));
    await controller.connect(alice);
    first.subscribed("SUBSCRIBED");
    first.subscribed("CHANNEL_ERROR");
    controller.catchUp();
    await vi.waitFor(() => expect(createClientFn).toHaveBeenCalledTimes(2));
    second.subscribed("SUBSCRIBED");
    expect(events.filter((event) => event === "connected")).toHaveLength(2);
    controller.disconnect();
    first.changed({ id: "late", thread_id: alice, sender_id: alice, recipient_id: alice, body: "late", created_at: new Date().toISOString(), read_at: null });
    expect(events).not.toContain("late");
  });
});
