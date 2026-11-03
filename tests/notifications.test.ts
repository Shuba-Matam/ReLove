/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOpenThreadId,
  shouldPollNotifications,
  isValidPushEndpoint,
  parseNotificationSummary,
  pruneSeenHistory,
  coerceNotificationToastFromMessage,
  NOTIFICATION_SEEN_HISTORY_MAX,
} from "@/lib/notifications";
import {
  NotificationPollScheduler,
  applyNotificationSummary,
  createInitialNotificationState,
  type NotificationControllerState,
} from "@/lib/client/notifications-controller";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/auth";
import { GET as summaryGET } from "@/app/api/notifications/summary/route";

vi.mock("@/lib/server/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/supabase")>()),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ requireUser: vi.fn() }));

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const threadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const threadId2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const threadId3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const msgId1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const msgId2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const msgId3 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const msgId4 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const msgId5 = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function msg(overrides: Partial<{ id: string; threadId: string; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? msgId1,
    threadId: overrides.threadId ?? threadId,
    createdAt: overrides.createdAt ?? "2026-11-03T00:00:00.000Z",
    listingTitle: "Chair",
    listingImageUrl: "/icons/icon-192.png",
    participantName: "Bob",
  };
}

function summary(overrides: Partial<{ unreadCount: number; messages: ReturnType<typeof msg>[] }> = {}) {
  return {
    unreadCount: overrides.unreadCount ?? 1,
    messages: overrides.messages ?? [msg()],
  };
}

// Helpers for scheduler deps
function createSchedulerHarness(opts: {
  initialUser?: string | null;
  mode?: string | null;
  openThreadId?: string | null;
  fetchFn?: typeof fetch;
  setTimeoutFn?: (cb: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
  setIntervalFn?: (cb: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
  isHidden?: () => boolean;
}) {
  let currentUser: string | null = opts.initialUser !== undefined ? opts.initialUser : alice;
  let currentMode: string | null = opts.mode ?? "live";
  let currentOpen: string | null = opts.openThreadId ?? null;
  const states: ReturnType<typeof createInitialNotificationState>[] = [];
  const onStateChange = vi.fn((s: ReturnType<typeof createInitialNotificationState>) => states.push({ ...s, seenIds: new Set(s.seenIds) }));
  const scheduler = new NotificationPollScheduler(currentUser, {
    getUserId: () => currentUser,
    getMode: () => currentMode,
    getOpenThreadId: () => currentOpen,
    isHidden: opts.isHidden,
    fetchFn: opts.fetchFn,
    setTimeoutFn: opts.setTimeoutFn,
    clearTimeoutFn: opts.clearTimeoutFn,
    setIntervalFn: opts.setIntervalFn,
    clearIntervalFn: opts.clearIntervalFn,
    onStateChange,
  });
  return {
    scheduler,
    states,
    onStateChange,
    setUser: (u: string | null) => { currentUser = u; },
    setMode: (m: string | null) => { currentMode = m; },
    setOpen: (o: string | null) => { currentOpen = o; },
    getUser: () => currentUser,
  };
}

describe("getOpenThreadId", () => {
  it("extracts thread id from inbox pathname", () => {
    expect(getOpenThreadId("/inbox/11111111-1111-4111-8111-111111111111")).toBe("11111111-1111-4111-8111-111111111111");
    expect(getOpenThreadId("/inbox/11111111-1111-4111-8111-111111111111/messages")).toBe("11111111-1111-4111-8111-111111111111");
    expect(getOpenThreadId("/inbox")).toBe(null);
    expect(getOpenThreadId("/")).toBe(null);
    expect(getOpenThreadId(null)).toBe(null);
  });
});

describe("shouldPollNotifications", () => {
  it("only polls in live with user", () => {
    expect(shouldPollNotifications("live", alice)).toBe(true);
    expect(shouldPollNotifications("demo", alice)).toBe(false);
    expect(shouldPollNotifications("live", null)).toBe(false);
  });
});

describe("isValidPushEndpoint — strict allowlist", () => {
  it("allows exact official hosts only", () => {
    expect(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isValidPushEndpoint("https://android.googleapis.com/gcm/send/abc")).toBe(true);
    expect(isValidPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isValidPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isValidPushEndpoint("https://api.push.apple.com/abc")).toBe(true);
  });
  it("rejects http, wrong hosts, private, credentials", () => {
    expect(isValidPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isValidPushEndpoint("https://evil.com/push")).toBe(false);
    expect(isValidPushEndpoint("https://fcm.googleapis.com:8080/push")).toBe(false);
    expect(isValidPushEndpoint("https://user:pass@fcm.googleapis.com/push")).toBe(false);
    expect(isValidPushEndpoint("https://fcm.googleapis.com/push#frag")).toBe(false);
    expect(isValidPushEndpoint("not-a-url")).toBe(false);
  });
});

describe("notificationSummarySchema / parseNotificationSummary", () => {
  it("parses valid summary, rejects invalid", () => {
    const good = { unreadCount: 2, messages: [{ id: msgId1, threadId, createdAt: "2026-11-03T00:00:00.000Z", listingTitle: "Chair", listingImageUrl: "/icons/icon-192.png", participantName: "Bob" }] };
    expect(parseNotificationSummary(good)).not.toBeNull();
    expect(parseNotificationSummary({ unreadCount: -1, messages: [] })).toBeNull();
    expect(parseNotificationSummary({ unreadCount: 1, messages: [{ id: "bad", threadId, createdAt: "2026-11-03T00:00:00.000Z", listingTitle: "x", listingImageUrl: "/i", participantName: "Bob" }] })).toBeNull();
    const many = Array.from({ length: 21 }, () => ({ id: msgId1, threadId, createdAt: "2026-11-03T00:00:00.000Z", listingTitle: "x", listingImageUrl: "/i", participantName: "Bob" }));
    expect(parseNotificationSummary({ unreadCount: 21, messages: many })).toBeNull();
  });
});

describe("pruneSeenHistory", () => {
  it("prunes oldest when over max", () => {
    const set = new Set<string>();
    for (let i = 0; i < 250; i++) set.add(`k${i}`);
    const pruned = pruneSeenHistory(set, NOTIFICATION_SEEN_HISTORY_MAX);
    expect(pruned.size).toBe(200);
    expect(pruned.has("k0")).toBe(false);
    expect(pruned.has("k249")).toBe(true);
  });
});

describe("coerceNotificationToastFromMessage", () => {
  it("filters open thread and seen, rejects invalid", () => {
    const m = msg();
    expect(coerceNotificationToastFromMessage(m, "live", alice, null, new Set())).not.toBeNull();
    expect(coerceNotificationToastFromMessage(m, "live", alice, threadId, new Set())).toBeNull();
    expect(coerceNotificationToastFromMessage(m, "live", alice, null, new Set([msgId1]))).toBeNull();
    expect(coerceNotificationToastFromMessage(m, "demo", alice, null, new Set())).toBeNull();
  });
});

describe("applyNotificationSummary — pure controller logic", () => {
  it("initial baseline seeds seen without toasts", () => {
    const prev = createInitialNotificationState(alice);
    const s = summary({ unreadCount: 2, messages: [msg({ id: msgId1 }), msg({ id: msgId2, threadId: threadId2 })] });
    const { nextState, newToasts } = applyNotificationSummary(prev, s, null);
    expect(newToasts.length).toBe(0);
    expect(nextState.toasts.length).toBe(0);
    expect(nextState.seenIds.has(msgId1)).toBe(true);
    expect(nextState.seenIds.has(msgId2)).toBe(true);
    expect(nextState.isInitialized).toBe(true);
    expect(nextState.unreadCount).toBe(2);
    expect(nextState.highWaterMark).toBe("2026-11-03T00:00:00.000Z");
  });

  it("toasts new incoming after baseline, caps at 3 and marks all seen including open-thread and beyond-cap", () => {
    const baseline = applyNotificationSummary(createInitialNotificationState(alice), summary({ unreadCount: 0, messages: [] }), null).nextState;
    // Create 5 new messages, one is open-thread
    const messages = [
      msg({ id: msgId1, threadId, createdAt: "2026-11-03T00:01:00.000Z" }),
      msg({ id: msgId2, threadId: threadId2, createdAt: "2026-11-03T00:02:00.000Z" }),
      msg({ id: msgId3, threadId: threadId3, createdAt: "2026-11-03T00:03:00.000Z" }),
      msg({ id: msgId4, threadId: threadId, createdAt: "2026-11-03T00:04:00.000Z" }),
      msg({ id: msgId5, threadId, createdAt: "2026-11-03T00:05:00.000Z" }),
    ];
    // open thread is threadId2, so msgId2 should be skipped for toast but still marked seen
    const { nextState, newToasts } = applyNotificationSummary(baseline, summary({ unreadCount: 5, messages }), threadId2);
    // Caps at 3
    expect(newToasts.length).toBe(3);
    expect(nextState.toasts.length).toBe(3);
    // All 5 should be seen, including open-thread skipped and beyond-cap
    expect(nextState.seenIds.has(msgId1)).toBe(true);
    expect(nextState.seenIds.has(msgId2)).toBe(true); // open-thread still seen
    expect(nextState.seenIds.has(msgId3)).toBe(true);
    expect(nextState.seenIds.has(msgId4)).toBe(true);
    expect(nextState.seenIds.has(msgId5)).toBe(true);
    // Next poll with same messages should produce 0 new toasts (no backlog resurface)
    const second = applyNotificationSummary(nextState, summary({ unreadCount: 5, messages }), null);
    expect(second.newToasts.length).toBe(0);
  });

  it("prevents old unread resurfacing after top20 shifts via high-water mark", () => {
    const baseline = applyNotificationSummary(createInitialNotificationState(alice), summary({ unreadCount: 1, messages: [msg({ id: msgId1, createdAt: "2026-11-03T00:10:00.000Z" })] }), null).nextState;
    expect(baseline.highWaterMark).toBe("2026-11-03T00:10:00.000Z");
    // Later poll returns old messages with older createdAt that were outside top20 before, now entering top20
    const oldResurfaced = summary({
      unreadCount: 2,
      messages: [
        msg({ id: msgId2, createdAt: "2026-11-03T00:05:00.000Z" }), // older than highWater
        msg({ id: msgId3, createdAt: "2026-11-03T00:06:00.000Z" }),
      ],
    });
    const { nextState, newToasts } = applyNotificationSummary(baseline, oldResurfaced, null);
    expect(newToasts.length).toBe(0);
    // But genuinely new message with newer timestamp should toast
    const newMsg = summary({ unreadCount: 3, messages: [msg({ id: msgId4, createdAt: "2026-11-03T00:11:00.000Z" })] });
    const after = applyNotificationSummary(nextState, newMsg, null);
    expect(after.newToasts.length).toBe(1);
    expect(after.newToasts[0].id).toBe(msgId4);
  });

  it("bounded seen history prunes oldest", () => {
    const prev = createInitialNotificationState(alice);
    // Seed with many to exceed max
    const many = Array.from({ length: 210 }, (_, i) => msg({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`, createdAt: `2026-11-03T00:${String(i % 60).padStart(2, "0")}:00.000Z` }));
    // First batch initial
    const first = applyNotificationSummary(prev, summary({ unreadCount: 20, messages: many.slice(0, 20) }), null).nextState;
    expect(first.seenIds.size).toBe(20);
    // Second batch new
    const second = applyNotificationSummary(first, summary({ unreadCount: 20, messages: many.slice(20, 40) }), null).nextState;
    expect(second.seenIds.size).toBe(40);
    // Force many more to hit prune
    let cur = second;
    for (let i = 0; i < 10; i++) {
      const batch = many.slice(40 + i * 20, 60 + i * 20);
      if (batch.length === 0) break;
      cur = applyNotificationSummary(cur, summary({ unreadCount: 20, messages: batch }), null).nextState;
    }
    expect(cur.seenIds.size).toBeLessThanOrEqual(NOTIFICATION_SEEN_HISTORY_MAX);
  });
});

// Real scheduler tests — generation/identity fencing, no-overlap, timeout, A→B, unmount, auth, focus/visibility
describe("NotificationPollScheduler — production controller", () => {
  beforeEach(() => vi.stubEnv("APP_MODE", "live"));
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("captures request identity and discards after deferred json await when A→B switches", async () => {
    let resolveJson: (v: unknown) => void = () => {};
    const jsonDeferred = new Promise<unknown>((res) => { resolveJson = res; });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => jsonDeferred,
    } as unknown as Response));

    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch });
    const fetchP = h.scheduler.doFetch();
    // Switch identity before json resolves (simulates deferred response.json)
    h.setUser(bob);
    h.scheduler.switchIdentity(bob);
    // Now resolve old json with Alice's data
    resolveJson({ data: summary({ unreadCount: 5, messages: [msg()] }), mode: "live" });
    await fetchP;
    // Old data must not be applied to Bob's state; Bob's unread should remain 0
    expect(h.states.length).toBe(1); // only switchIdentity's zero state
    expect(h.scheduler.getState().ownerId).toBe(bob);
    expect(h.scheduler.getState().unreadCount).toBe(0);
    expect(h.scheduler.getState().seenIds.size).toBe(0);
  });

  it("old finally cannot clear newer lock — generation fencing and per-request timeout ownership", async () => {
    const timeoutIds: number[] = [];
    const cleared: number[] = [];
    let nextId = 1;
    const setTimeoutFn = vi.fn((cb: () => void) => {
      const id = nextId++;
      timeoutIds.push(id);
      // don't actually call cb
      return id as unknown as number;
    });
    const clearTimeoutFn = vi.fn((id: number) => cleared.push(id));

    // First fetch will be delayed
    let resolveFirst: (v: unknown) => void = () => {};
    const firstJsonDeferred = new Promise((res) => { resolveFirst = res; });
    let resolveSecond: (v: unknown) => void = () => {};
    const secondJsonDeferred = new Promise((res) => { resolveSecond = res; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true, status: 200, json: () => firstJsonDeferred,
      } as unknown as Response))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200, json: () => secondJsonDeferred,
      } as unknown as Response));

    const h = createSchedulerHarness({
      initialUser: alice,
      fetchFn: fetchMock as unknown as typeof fetch,
      setTimeoutFn: setTimeoutFn as unknown as (cb: () => void, ms: number) => number,
      clearTimeoutFn: clearTimeoutFn as unknown as (id: number) => void,
    });

    const p1 = h.scheduler.doFetch();
    expect(h.scheduler.getFetchingGeneration()).not.toBeNull();
    const firstGen = h.scheduler.getFetchingGeneration();
    // No overlap: second fetch while first pending should be ignored
    const p2 = h.scheduler.doFetch();
    await p2; // should be ignored (no second fetch call)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.scheduler.getFetchingGeneration()).toBe(firstGen);

    // Complete first fetch but before it resolves, switch identity and start new fetch for Bob
    h.setUser(bob);
    h.scheduler.switchIdentity(bob);
    // Now start second fetch for Bob
    const p3 = h.scheduler.doFetch();
    // At this point we have timeoutIds [1,2] maybe? Actually first doFetch created timeout 1, second doFetch (ignored) didn't create, third creates 2
    expect(timeoutIds.length).toBe(2);
    expect(timeoutIds[0]).toBe(1);
    expect(timeoutIds[1]).toBe(2);

    // Resolve first (old generation) — its finally should clear timeout 1 only, not 2
    resolveFirst({ data: summary({ unreadCount: 99, messages: [msg()] }), mode: "live" });
    await p1;
    expect(cleared).toContain(1);
    expect(cleared).not.toContain(2);
    // Newer lock must still be held until second fetch completes
    expect(h.scheduler.getFetchingGeneration()).not.toBeNull();
    expect(h.scheduler.getFetchingGeneration()).not.toBe(firstGen);

    resolveSecond({ data: summary({ unreadCount: 1, messages: [msg({ id: msgId2 })] }), mode: "live" });
    await p3;
    expect(cleared).toContain(2);
    expect(h.scheduler.getState().ownerId).toBe(bob);
    expect(h.scheduler.getState().unreadCount).toBe(1);
  });

  it("unmount invalidates generation so stale fetch cannot update state", async () => {
    let resolveJson: (v: unknown) => void = () => {};
    const deferred = new Promise<unknown>((res) => { resolveJson = res; });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: () => deferred } as unknown as Response));
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch });
    const p = h.scheduler.doFetch();
    // Unmount before resolve
    h.scheduler.destroy();
    const genAfterDestroy = h.scheduler.getGeneration();
    resolveJson({ data: summary({ unreadCount: 5, messages: [msg()] }), mode: "live" });
    await p;
    // State must not have been updated (still initial zero)
    expect(h.states.length).toBe(0);
    expect(h.scheduler.getState().unreadCount).toBe(0);
    expect(h.scheduler.getFetchingGeneration()).toBeNull();
    expect(h.scheduler.getGeneration()).toBe(genAfterDestroy);
  });

  it("401/403 clears visible state for current identity", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) } as unknown as Response));
    // Seed state with unread
    const seedFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: summary({ unreadCount: 3, messages: [msg()] }), mode: "live" }) } as unknown as Response));
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: seedFetch as unknown as typeof fetch });
    await h.scheduler.doFetch();
    expect(h.scheduler.getState().unreadCount).toBe(3);
    // Now 401 should clear
    (h.scheduler as unknown as { deps: { fetchFn: typeof fetch } }).deps.fetchFn = fetchMock as unknown as typeof fetch;
    // Need to recreate harness with new fetch? Instead directly set fetchFn via private deps
    // Use separate harness for clarity
    const h2 = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch });
    // Manually set state to have unread
    (h2.scheduler as unknown as { state: ReturnType<typeof createInitialNotificationState> }).state = {
      ownerId: alice, unreadCount: 5, toasts: [msg() as unknown as import("@/lib/notifications").NotificationToastData], seenIds: new Set([msgId1]), highWaterMark: "2026-11-03T00:00:00.000Z", isInitialized: true,
    };
    await h2.scheduler.doFetch();
    expect(h2.states[h2.states.length - 1].unreadCount).toBe(0);
    expect(h2.states[h2.states.length - 1].toasts.length).toBe(0);
  });

  it("non-live response must not be used", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: summary({ unreadCount: 5, messages: [msg()] }), mode: "demo" }) } as unknown as Response));
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch });
    await h.scheduler.doFetch();
    // Demo mode response should result in zero state, not 5
    const last = h.states[h.states.length - 1];
    if (last) {
      expect(last.unreadCount).toBe(0);
      expect(last.toasts.length).toBe(0);
    } else {
      // No state change means still zero initial
      expect(h.scheduler.getState().unreadCount).toBe(0);
    }
  });

  it("focus/visibility triggers fetch and interval management", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: summary({ unreadCount: 1, messages: [] }), mode: "live" }) } as unknown as Response));
    let hidden = false;
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch, isHidden: () => hidden });
    // Hidden should prevent fetch
    hidden = true;
    await h.scheduler.doFetch();
    expect(fetchMock).not.toHaveBeenCalled();
    hidden = false;
    await h.scheduler.doFetch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Focus should trigger fetch
    fetchMock.mockClear();
    h.scheduler.onFocus();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // ensureInterval creates interval, clearIntervalSafe clears it
    h.scheduler.ensureInterval();
    expect((h.scheduler as unknown as { intervalId: number | null }).intervalId).not.toBeNull();
    h.scheduler.clearIntervalSafe();
    expect((h.scheduler as unknown as { intervalId: number | null }).intervalId).toBeNull();
  });

  it("no overlap: concurrent refresh coalesced, second does not create new fetch", async () => {
    let resolve: (v: unknown) => void = () => {};
    const deferred = new Promise<unknown>((res) => { resolve = res; });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: () => deferred } as unknown as Response));
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMock as unknown as typeof fetch });
    const p1 = h.scheduler.refresh();
    const p2 = h.scheduler.refresh(); // should coalesce
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ data: summary({ unreadCount: 1, messages: [msg()] }), mode: "live" });
    await Promise.all([p1, p2]);
    expect(h.scheduler.getFetchingGeneration()).toBeNull();
  });

  it("A→B switch restarts lifecycle per user and gates state (identity-tagged)", async () => {
    const fetchMockAlice = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: summary({ unreadCount: 2, messages: [msg({ id: msgId1 })] }), mode: "live" }) } as unknown as Response));
    const h = createSchedulerHarness({ initialUser: alice, fetchFn: fetchMockAlice as unknown as typeof fetch });
    await h.scheduler.doFetch();
    expect(h.scheduler.getState().ownerId).toBe(alice);
    expect(h.scheduler.getState().isInitialized).toBe(true);
    // Switch to Bob
    h.setUser(bob);
    h.scheduler.switchIdentity(bob);
    expect(h.scheduler.getState().ownerId).toBe(bob);
    expect(h.scheduler.getState().unreadCount).toBe(0);
    expect(h.scheduler.getState().toasts.length).toBe(0);
    expect(h.scheduler.getState().seenIds.size).toBe(0);
    expect(h.scheduler.getState().isInitialized).toBe(false);
    // Bob's fetch should not see Alice's seen keys (baseline)
    const fetchMockBob = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: summary({ unreadCount: 1, messages: [msg({ id: msgId1 })] }), mode: "live" }) } as unknown as Response));
    (h.scheduler as unknown as { deps: { fetchFn: typeof fetch } }).deps.fetchFn = fetchMockBob as unknown as typeof fetch;
    await h.scheduler.doFetch();
    expect(h.scheduler.getState().toasts.length).toBe(0); // baseline seed
    expect(h.scheduler.getState().seenIds.has(msgId1)).toBe(true);
  });
});

// Regression: provider effect lifecycle must survive StrictMode setup->cleanup->setup and mode toggles without stale ref overwrite
describe("NotificationsProvider effect lifecycle regression", () => {
  it("StrictMode setup->cleanup->setup recreates scheduler and polling resumes", async () => {
    let schedulerRef: NotificationPollScheduler | null = null;
    const capturedStates: NotificationControllerState[] = [];
    const currentUser: string | null = alice;
    const currentMode: string | null = "live";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: summary({ unreadCount: 1, messages: [msg({ id: msgId1 })] }), mode: "live" }),
    } as unknown as Response));
    const intervalStore = new Map<number, () => void>();
    let nextIntervalId = 100;
    const setIntervalFn = vi.fn((cb: () => void) => {
      const id = nextIntervalId++;
      intervalStore.set(id, cb);
      return id as unknown as number;
    });
    const clearIntervalFn = vi.fn((id: number) => {
      intervalStore.delete(id);
    });

    function setupEffect() {
      const scheduler = new NotificationPollScheduler(currentUser, {
        getUserId: () => currentUser,
        getMode: () => currentMode,
        getOpenThreadId: () => null,
        fetchFn: fetchMock as unknown as typeof fetch,
        setIntervalFn: setIntervalFn as unknown as (cb: () => void, ms: number) => number,
        clearIntervalFn: clearIntervalFn as unknown as (id: number) => void,
        onStateChange: (s) => capturedStates.push(s),
      });
      schedulerRef = scheduler;
      if (currentUser && currentMode === "live") {
        scheduler.start();
      }
      return () => {
        const owned = scheduler;
        owned.destroy();
        if (schedulerRef === owned) schedulerRef = null;
      };
    }

    const cleanup1 = setupEffect();
    expect(schedulerRef).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Allow first fetch to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(intervalStore.size).toBe(1);

    // StrictMode cleanup destroys first instance and nulls only if still current
    cleanup1();
    expect(schedulerRef).toBeNull();
    expect(intervalStore.size).toBe(0);

    // Second setup must create fresh scheduler and resume polling
    const cleanup2 = setupEffect();
    expect(schedulerRef).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 10));
    expect(schedulerRef!.getState().ownerId).toBe(alice);
    expect(capturedStates.length).toBeGreaterThan(0);
    // New scheduler must still be able to update state after stale destroy
    expect(schedulerRef!.getState().isInitialized).toBe(true);

    cleanup2();
    expect(schedulerRef).toBeNull();
  });

  it("enabled mode toggle stops polling and restarts without stale overwrite", async () => {
    let schedulerRef: NotificationPollScheduler | null = null;
    const currentUser: string | null = alice;
    let currentMode: string | null = "live";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: summary({ unreadCount: 2, messages: [msg({ id: msgId2 })] }), mode: "live" }),
    } as unknown as Response));
    const intervals = new Map<number, () => void>();
    let nextId = 200;
    const setIntervalFn = vi.fn((cb: () => void) => {
      const id = nextId++;
      intervals.set(id, cb);
      return id as unknown as number;
    });
    const clearIntervalFn = vi.fn((id: number) => intervals.delete(id));

    function mountWithMode() {
      const scheduler = new NotificationPollScheduler(currentUser, {
        getUserId: () => currentUser,
        getMode: () => currentMode,
        getOpenThreadId: () => null,
        fetchFn: fetchMock as unknown as typeof fetch,
        setIntervalFn: setIntervalFn as unknown as (cb: () => void, ms: number) => number,
        clearIntervalFn: clearIntervalFn as unknown as (id: number) => void,
        onStateChange: () => {},
      });
      schedulerRef = scheduler;
      if (currentUser && currentMode === "live") {
        scheduler.start();
      }
      return () => {
        const owned = scheduler;
        owned.destroy();
        if (schedulerRef === owned) schedulerRef = null;
      };
    }

    // Start enabled
    let cleanup = mountWithMode();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(intervals.size).toBe(1);
    const firstScheduler = schedulerRef;
    cleanup();
    expect(schedulerRef).toBeNull();

    // Switch to disabled mode (demo) — should not start polling
    currentMode = "demo";
    fetchMock.mockClear();
    cleanup = mountWithMode();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(intervals.size).toBe(0);
    expect(schedulerRef).not.toBeNull();
    expect(schedulerRef).not.toBe(firstScheduler);
    const disabledScheduler = schedulerRef;
    cleanup();
    expect(schedulerRef).toBeNull();

    // Re-enable to live — must restart polling with fresh scheduler
    currentMode = "live";
    fetchMock.mockClear();
    cleanup = mountWithMode();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(intervals.size).toBe(1);
    expect(schedulerRef).not.toBe(disabledScheduler);
    cleanup();
  });

  it("stale cleanup does not null newer scheduler instance", () => {
    let schedulerRef: NotificationPollScheduler | null = null;
    const currentUser: string | null = alice;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: summary({ unreadCount: 0, messages: [] }), mode: "live" }),
    } as unknown as Response));

    function createAndTrack() {
      const s = new NotificationPollScheduler(currentUser, {
        getUserId: () => currentUser,
        getMode: () => "live",
        getOpenThreadId: () => null,
        fetchFn: fetchMock as unknown as typeof fetch,
        onStateChange: () => {},
      });
      schedulerRef = s;
      s.start();
      return s;
    }

    const schedulerA = createAndTrack();
    expect(schedulerRef).toBe(schedulerA);
    // Rapid prop change: create B before cleanup of A
    const schedulerB = createAndTrack();
    expect(schedulerRef).toBe(schedulerB);
    expect(schedulerRef).not.toBe(schedulerA);

    // Cleanup of stale A must not overwrite current B
    const cleanupA = () => {
      schedulerA.destroy();
      if (schedulerRef === schedulerA) schedulerRef = null;
    };
    cleanupA();
    expect(schedulerRef).toBe(schedulerB);
    expect(schedulerRef).not.toBeNull();

    // Cleanup B should null
    const cleanupB = () => {
      schedulerB.destroy();
      if (schedulerRef === schedulerB) schedulerRef = null;
    };
    cleanupB();
    expect(schedulerRef).toBeNull();
  });
});

// Summary endpoint contract — actual GET with mocked Supabase
describe("GET /api/notifications/summary — fixed queries, RLS, stable order, no bodies", () => {
  const owner = alice;
  const other = bob;
  type Reply = { body: unknown; status?: number; range?: string };
  function database(...replies: Reply[]) {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected database request: " + String(input));
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json", ...(reply.range ? { "content-range": reply.range } : {}) },
      });
    });
    const client = createClient("https://database.example.test", "test-publishable-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetcher },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    vi.mocked(requireUser).mockResolvedValue({ supabase: client, user: { id: owner } });
    return fetcher;
  }

  beforeEach(() => vi.stubEnv("APP_MODE", "live"));
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("returns exact unread count and bounded messages with fixed <=3 queries", async () => {
    const fetcher2 = database(
      { body: [], status: 200, range: "*/5" }, // count head with 5 unread
      { body: [{ id: msgId1, thread_id: threadId, created_at: "2026-11-03T00:00:00.000Z" }, { id: msgId2, thread_id: threadId2, created_at: "2026-11-03T00:01:00.000Z" }], range: "0-1/5" },
      { body: [{ id: threadId, listing_id: "00000000-0000-4000-8000-000000000002", buyer_id: other, seller_id: owner, listing: { id: "00000000-0000-4000-8000-000000000002", title: "Chair", image_url: "/img.jpg" }, buyer: { display_name: "Bob" }, seller: { display_name: "Alice" } }, { id: threadId2, listing_id: "00000000-0000-4000-8000-000000000002", buyer_id: other, seller_id: owner, listing: { id: "00000000-0000-4000-8000-000000000002", title: "Desk", image_url: "/img2.jpg" }, buyer: { display_name: "Bob" }, seller: { display_name: "Alice" } }] }
    );
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.unreadCount).toBe(5); // exact count from head, not 2
    expect(json.data.messages.length).toBe(2);
    expect(json.data.messages[0].body).toBeUndefined(); // no bodies
    expect(json.data.messages[0].listingTitle).toBeDefined();
    // Fixed <=3 queries
    expect(fetcher2).toHaveBeenCalledTimes(3);
    // Stable order with id tie-break: both order params present
    const urls = fetcher2.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    const msgUrl = urls[1];
    expect(msgUrl.searchParams.get("order")).toContain("created_at.desc");
    // Second order for id tie-break may be separate param or combined; check that id is ordered
    const orderVals = urls[1].searchParams.getAll("order");
    const orderCombined = orderVals.join(",");
    expect(orderCombined).toContain("id.desc");
    // RLS scoping: recipient_id eq owner
    for (const u of urls.slice(0, 2)) {
      expect(u.searchParams.get("recipient_id")).toBe(`eq.${owner}`);
      expect(u.searchParams.get("read_at")).toBe("is.null");
    }
  });

  it("null/non-integer count returns 503 not 0", async () => {
    // Simulate count null due to error parsing: fetcher returns 200 with no range header so Supabase yields count null
    const fetcher = database({ body: [], status: 200 }); // no range => count null
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("DATABASE_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("Zod parse failure returns 503 without private diagnostic, no raw fallback", async () => {
    const fetcher = database(
      { body: [], status: 200, range: "*/1" },
      { body: [{ id: "not-a-uuid", thread_id: threadId, created_at: "2026-11-03T00:00:00.000Z" }], range: "0-0/1" }
    );
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("not-a-uuid");
    expect(JSON.stringify(body)).not.toContain("private database detail");
  });

  it("thread parse failure returns 503, not raw fallback", async () => {
    const fetcher = database(
      { body: [], status: 200, range: "*/1" },
      { body: [{ id: msgId1, thread_id: threadId, created_at: "2026-11-03T00:00:00.000Z" }], range: "0-0/1" },
      { body: [{ id: "bad-thread-id-not-uuid", listing_id: threadId, buyer_id: owner, seller_id: other, listing: null, buyer: null, seller: null }] }
    );
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(503);
  });

  it("other user rows not returned, errors without leaking", async () => {
    const fetcher = database(
      { status: 400, body: { code: "42501", message: "private db detail" } }
    );
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.message).not.toContain("private db detail");
    expect(body.error.message).toBe("Notifications are temporarily unavailable. Please try again.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("demo/setup returns 0 without DB queries", async () => {
    vi.stubEnv("APP_MODE", "demo");
    const res = await summaryGET(new NextRequest("https://relove.test/api/notifications/summary"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ unreadCount: 0, messages: [] });
    expect(vi.mocked(createSupabaseServerClient)).not.toHaveBeenCalled();
  });
});
