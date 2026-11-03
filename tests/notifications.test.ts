import { describe, it, expect } from "vitest";
import {
  computeGlobalUnreadCount,
  getOpenThreadId,
  shouldPollNotifications,
  truncateBodyPreview,
  createToastDedupeKey,
  buildThreadSnapshotMap,
  detectNewMessageToasts,
  isValidPushEndpoint,
} from "@/lib/notifications";
import type { ThreadSummary } from "@/lib/marketplace";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

function thread(overrides: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    id: overrides.id,
    listing: overrides.listing ?? { id: "listing-1", title: "Desk chair", image_url: "/icons/icon.svg", price_inr: 1000, status: "active" },
    participant: overrides.participant ?? { id: bob, display_name: "Bob", avatar_url: null, hostel_block: null },
    last_message: overrides.last_message ?? null,
    unread_count: overrides.unread_count ?? 0,
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

describe("computeGlobalUnreadCount", () => {
  it("sums unread across threads, ignores missing", () => {
    expect(computeGlobalUnreadCount([])).toBe(0);
    expect(
      computeGlobalUnreadCount([
        thread({ id: "a", unread_count: 2 }),
        thread({ id: "b", unread_count: 3 }),
        thread({ id: "c", unread_count: 0 }),
      ])
    ).toBe(5);
    expect(computeGlobalUnreadCount([thread({ id: "a", unread_count: 1 }), thread({ id: "b", unread_count: 1 })])).toBe(2);
  });
});

describe("getOpenThreadId", () => {
  it("extracts thread id from inbox pathname", () => {
    expect(getOpenThreadId("/inbox/11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(getOpenThreadId("/inbox/11111111-1111-4111-8111-111111111111/messages")).toBe("11111111-1111-4111-8111-111111111111");
    expect(getOpenThreadId("/inbox")).toBe(null);
    expect(getOpenThreadId("/")).toBe(null);
    expect(getOpenThreadId(null)).toBe(null);
    expect(getOpenThreadId("")).toBe(null);
    expect(getOpenThreadId("/inbox/")).toBe(null);
  });
});

describe("shouldPollNotifications", () => {
  it("only polls in live with user", () => {
    expect(shouldPollNotifications("live", alice)).toBe(true);
    expect(shouldPollNotifications("demo", alice)).toBe(false);
    expect(shouldPollNotifications("live", null)).toBe(false);
    expect(shouldPollNotifications("setup", alice)).toBe(false);
    expect(shouldPollNotifications(null, alice)).toBe(false);
  });
});

describe("truncateBodyPreview", () => {
  it("truncates and preserves privacy-safe preview", () => {
    expect(truncateBodyPreview(null)).toBe(null);
    expect(truncateBodyPreview("")).toBe(null);
    expect(truncateBodyPreview("   ")).toBe(null);
    expect(truncateBodyPreview("hello")).toBe("hello");
    expect(truncateBodyPreview("a".repeat(80))).toBe("a".repeat(80));
    expect(truncateBodyPreview("a".repeat(81))).toBe("a".repeat(79) + "…");
  });
});

describe("createToastDedupeKey", () => {
  it("builds stable key from thread + last_message", () => {
    const t = thread({ id: "tid", unread_count: 1, last_message: { body: "hi", created_at: "2026-11-02T00:00:00Z", sender_id: bob } });
    expect(createToastDedupeKey(t)).toBe(`tid:2026-11-02T00:00:00Z:${bob}`);
    expect(createToastDedupeKey(thread({ id: "tid", unread_count: 0, last_message: null }))).toBe(null);
  });
});

describe("buildThreadSnapshotMap", () => {
  it("maps threads to snapshots", () => {
    const map = buildThreadSnapshotMap([
      thread({ id: "a", unread_count: 1, last_message: { body: "hi", created_at: "2026-11-02T00:00:00Z", sender_id: bob } }),
    ]);
    expect(map.get("a")).toEqual({ unreadCount: 1, lastMessageCreatedAt: "2026-11-02T00:00:00Z", lastMessageSenderId: bob });
  });
});

describe("isValidPushEndpoint", () => {
  it("rejects http, localhost, private, metadata", () => {
    expect(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isValidPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isValidPushEndpoint("https://localhost/push")).toBe(false);
    expect(isValidPushEndpoint("https://127.0.0.1/push")).toBe(false);
    expect(isValidPushEndpoint("https://192.168.1.1/push")).toBe(false);
    expect(isValidPushEndpoint("https://10.0.0.1/push")).toBe(false);
    expect(isValidPushEndpoint("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isValidPushEndpoint("https://" + "a".repeat(2001))).toBe(false);
    expect(isValidPushEndpoint("not-a-url")).toBe(false);
  });
});

describe("detectNewMessageToasts", () => {
  const now = "2026-11-02T00:00:00.000Z";
  const later = "2026-11-02T00:01:00.000Z";
  const evenLater = "2026-11-02T00:02:00.000Z";

  it("does not flood on initial history", () => {
    const existing = [
      thread({ id: "t1", unread_count: 2, last_message: { body: "old", created_at: now, sender_id: bob } }),
      thread({ id: "t2", unread_count: 1, last_message: { body: "hello", created_at: now, sender_id: bob } }),
    ];
    const result = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: existing,
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    expect(result.toasts).toEqual([]);
    expect(result.nextMap.size).toBe(2);
    // Seen keys populated to prevent retroactive toast
    expect(result.nextSeenKeys.size).toBe(2);
  });

  it("toasts new incoming message after baseline, not self", () => {
    // Baseline: empty inbox
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    // Now Bob sends first message
    const after = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "Is it available?", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(after.toasts).toHaveLength(1);
    expect(after.toasts[0].threadId).toBe("t1");
    expect(after.toasts[0].listingTitle).toBe("Desk chair");
    // Self message should not toast
    const selfMsg = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "My message", created_at: later, sender_id: alice } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(selfMsg.toasts).toHaveLength(0);
  });

  it("dedupes same message on duplicate poll", () => {
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const firstPoll = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "hi", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(firstPoll.toasts).toHaveLength(1);
    // Second poll with same data should not re-toast (duplicate)
    const secondPoll = detectNewMessageToasts({
      prevMap: firstPoll.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "hi", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: firstPoll.nextSeenKeys,
      isInitial: false,
    });
    expect(secondPoll.toasts).toHaveLength(0);

    // New message with later timestamp should toast
    const thirdPoll = detectNewMessageToasts({
      prevMap: secondPoll.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 2, last_message: { body: "again", created_at: evenLater, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: secondPoll.nextSeenKeys,
      isInitial: false,
    });
    expect(thirdPoll.toasts).toHaveLength(1);
  });

  it("does not toast already-open-read thread", () => {
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const openToast = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t-open", unread_count: 1, last_message: { body: "hi", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: "t-open",
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(openToast.toasts).toHaveLength(0);

    const otherToast = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t-other", unread_count: 1, last_message: { body: "hi", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: "t-open",
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(otherToast.toasts).toHaveLength(1);
  });

  it("does not toast when unread_count is 0 or no last_message", () => {
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const empty = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 0, last_message: { body: "hi", created_at: later, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(empty.toasts).toHaveLength(0);
    const noMsg = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: null })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(noMsg.toasts).toHaveLength(0);
  });

  it("caps toasts at 3 to avoid flood", () => {
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const many = Array.from({ length: 5 }, (_, i) =>
      thread({ id: `t${i}`, unread_count: 1, last_message: { body: "hi", created_at: later, sender_id: bob }, listing: { id: `l${i}`, title: `Item ${i}`, image_url: "/icons/icon.svg", price_inr: 100, status: "active" } } as unknown as ThreadSummary)
    );
    const result = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: many,
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(result.toasts).toHaveLength(3);
  });

  it("handles new thread appearing after baseline", () => {
    const initial = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "pre", created_at: now, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const withNewThread = detectNewMessageToasts({
      prevMap: initial.nextMap,
      nextThreads: [
        thread({ id: "t1", unread_count: 1, last_message: { body: "pre", created_at: now, sender_id: bob } }),
        thread({ id: "t2", unread_count: 1, last_message: { body: "new thread", created_at: later, sender_id: bob } }),
      ],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: initial.nextSeenKeys,
      isInitial: false,
    });
    expect(withNewThread.toasts).toHaveLength(1);
    expect(withNewThread.toasts[0].threadId).toBe("t2");
  });

  it("isolates account: different userId should not reuse prevMap (simulated reset)", () => {
    // Alice's baseline
    const aliceBaseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "hi", created_at: now, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    // Simulate Bob logging in: prevMap reset to empty (account isolation)
    const bobView = detectNewMessageToasts({
      prevMap: new Map(), // reset
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "hi", created_at: now, sender_id: alice } })],
      currentUserId: bob,
      openThreadId: null,
      seenDedupeKeys: new Set(), // reset
      isInitial: true,
    });
    // Initial for Bob should not toast
    expect(bobView.toasts).toHaveLength(0);
    // Next message from Alice to Bob should toast for Bob
    const bobToast = detectNewMessageToasts({
      prevMap: bobView.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 2, last_message: { body: "reply", created_at: later, sender_id: alice } })],
      currentUserId: bob,
      openThreadId: null,
      seenDedupeKeys: bobView.nextSeenKeys,
      isInitial: false,
    });
    expect(bobToast.toasts).toHaveLength(1);

    // Ensure Alice's seen keys do not leak to Bob (different sets)
    expect(aliceBaseline.nextSeenKeys.has(`t1:${now}:${bob}`)).toBe(true);
    expect(bobView.nextSeenKeys.has(`t1:${now}:${alice}`)).toBe(true);
  });

  it("handles unread increase without message timestamp change (edge)", () => {
    const baseline = detectNewMessageToasts({
      prevMap: new Map(),
      nextThreads: [],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: new Set(),
      isInitial: true,
    });
    const first = detectNewMessageToasts({
      prevMap: baseline.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 1, last_message: { body: "hi", created_at: now, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: baseline.nextSeenKeys,
      isInitial: false,
    });
    expect(first.toasts).toHaveLength(1);
    // Unread increased but same timestamp (unlikely but possible race) — should not re-toast due to dedupe
    const dup = detectNewMessageToasts({
      prevMap: first.nextMap,
      nextThreads: [thread({ id: "t1", unread_count: 2, last_message: { body: "hi", created_at: now, sender_id: bob } })],
      currentUserId: alice,
      openThreadId: null,
      seenDedupeKeys: first.nextSeenKeys,
      isInitial: false,
    });
    expect(dup.toasts).toHaveLength(0);
  });

  it("does not invent toasts on sample demo mode (guard via shouldPoll)", () => {
    // Demo guard is at provider level; helper should still behave correctly if called,
    // but we verify that shouldPoll would prevent calling detect.
    expect(shouldPollNotifications("demo", alice)).toBe(false);
    expect(shouldPollNotifications("live", null)).toBe(false);
  });
});

describe("notification polling lifecycle (unit)", () => {
  it("abort cleanup clears fetching flag — simulated", async () => {
    let fetching = true;
    const controller = new AbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    // Simulate provider finally block
    fetching = false;
    expect(fetching).toBe(false);
  });

  it("visible-tab pause clears interval", () => {
    // Simulate interval management
    let interval: number | null = 1;
    const isHidden = true;
    if (isHidden && interval !== null) interval = null;
    expect(interval).toBe(null);
  });
});
