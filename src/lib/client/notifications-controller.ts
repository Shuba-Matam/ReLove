import {
  NOTIFICATION_MAX_TOASTS,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_POLL_TIMEOUT_MS,
  NOTIFICATION_SEEN_HISTORY_MAX,
  parseNotificationSummary,
  pruneSeenHistory,
  shouldPollNotifications,
  type NotificationSummary,
  type NotificationToastData,
} from "@/lib/notifications";

// Re-export for tests convenience
export {
  NOTIFICATION_MAX_TOASTS,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_POLL_TIMEOUT_MS,
  NOTIFICATION_SEEN_HISTORY_MAX,
};

export interface NotificationControllerState {
  ownerId: string | null;
  unreadCount: number;
  toasts: NotificationToastData[];
  seenIds: Set<string>;
  highWaterMark: string | null; // ISO timestamp of newest message ever seen
  isInitialized: boolean;
}

export function createInitialNotificationState(ownerId: string | null): NotificationControllerState {
  return {
    ownerId,
    unreadCount: 0,
    toasts: [],
    seenIds: new Set<string>(),
    highWaterMark: null,
    isInitialized: false,
  };
}

/**
 * Pure state transition: apply a fetched summary to previous state.
 * - On first fetch (isInitialized false): seed seenIds + highWaterMark, no toasts.
 * - On subsequent: mark every fetched message seen (including open-thread skipped), select at most 3 eligible toasts where createdAt > highWaterMark and not seen and not open-thread.
 * - High-water prevents old backlog resurfacing when top20 window shifts.
 * - Bounded via pruneSeenHistory.
 */
export function applyNotificationSummary(
  prev: NotificationControllerState,
  summary: NotificationSummary,
  openThreadId: string | null
): { nextState: NotificationControllerState; newToasts: NotificationToastData[] } {
  const nextSeen = new Set(prev.seenIds);
  let nextHighWater = prev.highWaterMark;

  // Compute max createdAt in this batch for high-water advancement
  let batchMax: string | null = null;
  for (const m of summary.messages) {
    if (!batchMax || m.createdAt > batchMax) batchMax = m.createdAt;
  }

  if (!prev.isInitialized) {
    for (const m of summary.messages) nextSeen.add(m.id);
    if (batchMax) nextHighWater = !nextHighWater || batchMax > nextHighWater ? batchMax : nextHighWater;
    const pruned = pruneSeenHistory(nextSeen, NOTIFICATION_SEEN_HISTORY_MAX);
    return {
      nextState: {
        ownerId: prev.ownerId,
        unreadCount: summary.unreadCount,
        toasts: [],
        seenIds: pruned,
        highWaterMark: nextHighWater,
        isInitialized: true,
      },
      newToasts: [],
    };
  }

  // Collect eligible toasts, but also record all ids as seen regardless
  const eligible: NotificationToastData[] = [];

  // First, determine which messages are eligible for toast (before marking seen)
  // Need to ensure we don't toast old messages that resurfaced: require createdAt > highWaterMark OR if highWaterMark is null, allow
  for (const m of summary.messages) {
    const isOpen = openThreadId !== null && m.threadId === openThreadId;
    const alreadySeen = prev.seenIds.has(m.id);
    const isOldResurfaced = prev.highWaterMark !== null && m.createdAt <= prev.highWaterMark && alreadySeen === false;
    // We still want to mark all as seen, but only toast if not open, not seen, not old resurfaced
    // isOldResurfaced prevents top20 shift resurfaces: old unread outside previous window now entering top20 should not toast because its time is older than what we've already acknowledged
    // However we must be careful: genuinely new messages have createdAt > highWaterMark, so they pass
    if (!isOpen && !alreadySeen && !isOldResurfaced) {
      eligible.push({
        id: m.id,
        threadId: m.threadId,
        listingTitle: m.listingTitle,
        listingImageUrl: m.listingImageUrl,
        participantName: m.participantName,
        createdAt: m.createdAt,
        bodyPreview: null,
      });
    }
  }

  // Cap to MAX, most recent first (summary.messages is already desc by createdAt+id, so eligible preserves order)
  const capped = eligible.slice(0, NOTIFICATION_MAX_TOASTS);

  // Now mark every fetched message seen, including open-thread and beyond-cap and old-resurfaced
  for (const m of summary.messages) {
    nextSeen.add(m.id);
  }
  if (batchMax) nextHighWater = !nextHighWater || batchMax > nextHighWater ? batchMax : nextHighWater;
  const pruned = pruneSeenHistory(nextSeen, NOTIFICATION_SEEN_HISTORY_MAX);

  // Merge new toasts with existing, dedupe, slice to MAX
  // For pure function we return capped as newToasts; scheduler will merge into state's toasts
  // But we need to also produce nextState with updated seen/highWater/unread
  // toasts merging is scheduler concern to keep bounded and deduped; here we just provide newToasts
  // However we will let caller merge; we return nextState without toasts changed yet
  // Actually we need to define nextState.toasts as merged, but to keep purity we can return nextState with previous toasts + new
  // Let's return nextState that includes merged toasts for convenience

  // Build merged toasts: new first, then previous, dedupe by id
  const combined = [...capped, ...prev.toasts];
  const seenForDedupe = new Set<string>();
  const deduped: NotificationToastData[] = [];
  for (const t of combined) {
    if (!seenForDedupe.has(t.id)) {
      seenForDedupe.add(t.id);
      deduped.push(t);
    }
  }
  const finalToasts = deduped.slice(0, NOTIFICATION_MAX_TOASTS);

  return {
    nextState: {
      ownerId: prev.ownerId,
      unreadCount: summary.unreadCount,
      toasts: finalToasts,
      seenIds: pruned,
      highWaterMark: nextHighWater,
      isInitialized: true,
    },
    newToasts: capped,
  };
}

// Scheduler dependencies for testability
export interface NotificationSchedulerDeps {
  fetchFn?: typeof fetch;
  setTimeoutFn?: (cb: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
  setIntervalFn?: (cb: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
  getUserId: () => string | null;
  getMode: () => string | null;
  getOpenThreadId: () => string | null;
  isHidden?: () => boolean;
  onStateChange: (state: NotificationControllerState) => void;
}

export class NotificationPollScheduler {
  private deps: NotificationSchedulerDeps;
  private state: NotificationControllerState;
  private generation = 0;
  private fetchingGeneration: number | null = null;
  private activeIdentity: string | null = null;
  private abortController: AbortController | null = null;
  private intervalId: number | null = null;
  private pendingRefresh: Promise<void> | null = null;
  private destroyed = false;

  constructor(initialOwnerId: string | null, deps: NotificationSchedulerDeps) {
    this.deps = deps;
    this.state = createInitialNotificationState(initialOwnerId);
    this.activeIdentity = initialOwnerId;
  }

  getState(): NotificationControllerState {
    return this.state;
  }

  getGeneration(): number {
    return this.generation;
  }

  getFetchingGeneration(): number | null {
    return this.fetchingGeneration;
  }

  /** Identity switch: clears rendered state, bumps generation, aborts fetch, clears interval */
  switchIdentity(newUserId: string | null): void {
    if (this.activeIdentity !== newUserId) {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      // Note: per-request local timer not stored globally; but we clear interval
      if (this.intervalId !== null) {
        const fn = this.deps.clearIntervalFn ?? clearInterval;
        fn(this.intervalId);
        this.intervalId = null;
      }
      this.fetchingGeneration = null;
      this.pendingRefresh = null;
      this.state = createInitialNotificationState(newUserId);
      this.activeIdentity = newUserId;
      this.generation += 1;
      this.deps.onStateChange(this.state);
    }
  }

  /** Invalidate for unmount: bump generation so stale work discards, cancel fetch */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.intervalId !== null) {
      const fn = this.deps.clearIntervalFn ?? clearInterval;
      fn(this.intervalId);
      this.intervalId = null;
    }
    this.fetchingGeneration = null;
    this.pendingRefresh = null;
  }

  private isEnabled(): boolean {
    return shouldPollNotifications(this.deps.getMode(), this.deps.getUserId());
  }

  dismissToast(id: string): void {
    if (this.state.ownerId !== this.deps.getUserId()) return;
    const nextToasts = this.state.toasts.filter((t) => t.id !== id);
    this.state = { ...this.state, toasts: nextToasts };
    this.deps.onStateChange(this.state);
  }

  async doFetch(): Promise<void> {
    const userId = this.deps.getUserId();
    const mode = this.deps.getMode();
    if (!shouldPollNotifications(mode, userId)) return;
    if (this.deps.isHidden?.() === true) return;
    if (this.fetchingGeneration !== null) return;
    if (this.destroyed) return;

    const requestGen = this.generation + 1;
    this.generation = requestGen;
    this.fetchingGeneration = requestGen;
    const capturedUserId = userId;
    const capturedGeneration = requestGen;

    if (this.abortController) this.abortController.abort();
    const controller = new AbortController();
    this.abortController = controller;

    const fetchFn = this.deps.fetchFn ?? fetch;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = this.deps.clearTimeoutFn ?? clearTimeout;

    // Each request owns local timer; clear its own only
    let localTimeoutId: number | null = null;
    localTimeoutId = setTimeoutFn(() => controller.abort(), NOTIFICATION_POLL_TIMEOUT_MS) as unknown as number;

    try {
      const res = await fetchFn.call(globalThis, "/api/notifications/summary", {
        cache: "no-store",
        signal: controller.signal,
        headers: { "Cache-Control": "no-store" },
      } as RequestInit);

      if (controller.signal.aborted) return;
      if (capturedGeneration !== this.generation) return;
      if (capturedUserId !== this.deps.getUserId()) return;
      if (capturedUserId !== this.activeIdentity) return;
      if (this.destroyed) return;

      if (!res.ok) {
        // Unauthorized must clear visible state for current identity
        if (res.status === 401 || res.status === 403) {
          if (capturedUserId === this.activeIdentity && capturedGeneration === this.generation) {
            this.state = { ...this.state, ownerId: capturedUserId, unreadCount: 0, toasts: [] };
            this.deps.onStateChange(this.state);
          }
        }
        // Non-live responses (e.g., demo/setup) should not be used; they may be 200 with mode field but we already check res.ok
        return;
      }

      // Deferred response.json must be gated as well (A->B during json await)
      const json = await (res.json().catch(() => null) as Promise<unknown>);

      if (controller.signal.aborted) return;
      if (capturedGeneration !== this.generation) return;
      if (capturedUserId !== this.deps.getUserId()) return;
      if (capturedUserId !== this.activeIdentity) return;
      if (this.destroyed) return;

      if (!json || typeof json !== "object") return;
      // Demo guard: server may include mode field inside data wrapper
      const maybeData = json as { data?: unknown; mode?: string };
      if (maybeData.mode === "demo" || maybeData.mode === "setup") {
        if (capturedUserId === this.activeIdentity && capturedGeneration === this.generation) {
          this.state = { ...this.state, ownerId: capturedUserId, unreadCount: 0, toasts: [] };
          this.deps.onStateChange(this.state);
        }
        return;
      }
      // Also check data wrapper if present, otherwise expect json to be summary directly for test flexibility
      const raw = (maybeData.data !== undefined ? maybeData.data : json) as unknown;
      // If data is null/undefined and json itself looks like summary, use json
      const summary = parseNotificationSummary(raw);
      if (!summary) {
        // Also try parsing json directly if raw failed but json is summary (fallback for mocks)
        const alt = parseNotificationSummary(json);
        if (!alt) return;
        // Gate again before applying
        if (capturedUserId !== this.activeIdentity) return;
        if (capturedGeneration !== this.generation) return;
        const openId = this.deps.getOpenThreadId();
        const { nextState } = applyNotificationSummary(this.state, alt, openId);
        // Ensure still current identity before state update
        if (capturedUserId !== this.activeIdentity) return;
        if (capturedGeneration !== this.generation) return;
        this.state = nextState;
        this.deps.onStateChange(this.state);
        return;
      }

      if (capturedUserId !== this.activeIdentity) return;
      if (capturedGeneration !== this.generation) return;

      const openId = this.deps.getOpenThreadId();
      const { nextState } = applyNotificationSummary(this.state, summary, openId);

      // Final gate before state update
      if (capturedUserId !== this.activeIdentity) return;
      if (capturedGeneration !== this.generation) return;
      if (this.destroyed) return;

      this.state = nextState;
      this.deps.onStateChange(this.state);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // swallow
    } finally {
      // Each request clears its own timer only
      if (localTimeoutId !== null) {
        clearTimeoutFn(localTimeoutId);
      }
      if (this.fetchingGeneration === capturedGeneration) {
        this.fetchingGeneration = null;
      }
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  async refresh(): Promise<void> {
    if (this.pendingRefresh) {
      await this.pendingRefresh;
      return;
    }
    const p = this.doFetch();
    this.pendingRefresh = p;
    try {
      await p;
    } finally {
      if (this.pendingRefresh === p) this.pendingRefresh = null;
    }
  }

  start(): void {
    const userId = this.deps.getUserId();
    if (!this.isEnabled() || !userId) {
      if (this.intervalId !== null) {
        const fn = this.deps.clearIntervalFn ?? clearInterval;
        fn(this.intervalId);
        this.intervalId = null;
      }
      return;
    }
    // Immediate fetch
    void this.doFetch();

    const ensureInterval = () => {
      if (this.intervalId !== null) return;
      if (this.deps.isHidden?.() === true) return;
      const setIntervalFn = this.deps.setIntervalFn ?? setInterval;
      this.intervalId = setIntervalFn(() => void this.doFetch(), NOTIFICATION_POLL_INTERVAL_MS) as unknown as number;
    };
    ensureInterval();
  }

  ensureInterval(): void {
    if (this.intervalId !== null) return;
    if (this.deps.isHidden?.() === true) return;
    const setIntervalFn = this.deps.setIntervalFn ?? setInterval;
    this.intervalId = setIntervalFn(() => void this.doFetch(), NOTIFICATION_POLL_INTERVAL_MS) as unknown as number;
  }

  clearIntervalSafe(): void {
    if (this.intervalId !== null) {
      const fn = this.deps.clearIntervalFn ?? clearInterval;
      fn(this.intervalId);
      this.intervalId = null;
    }
  }

  onFocus(): void {
    void this.doFetch();
    this.ensureInterval();
  }

  onFocusConnected(): void {
    void this.doFetch();
    this.clearIntervalSafe();
  }

  onVisibilityChange(): void {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void this.doFetch();
      this.ensureInterval();
    } else {
      this.clearIntervalSafe();
    }
  }

  onVisibilityChangeConnected(): void {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void this.doFetch();
    this.clearIntervalSafe();
  }
}
