/* eslint-disable react-hooks/set-state-in-effect -- notifications provider needs sync state reset for account isolation and polling lifecycle */
"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/client/session";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_POLL_TIMEOUT_MS,
  NOTIFICATION_MAX_TOASTS,
  NOTIFICATION_SEEN_HISTORY_MAX,
  getOpenThreadId,
  shouldPollNotifications,
  parseNotificationSummary,
  pruneSeenHistory,
  type NotificationToastData,
} from "@/lib/notifications";

export interface NotificationsContextValue {
  unreadCount: number;
  toasts: NotificationToastData[];
  dismissToast: (id: string) => void;
  refresh: () => Promise<void>;
  isPolling: boolean;
}

const NotificationsContext = React.createContext<NotificationsContextValue>({
  unreadCount: 0,
  toasts: [],
  dismissToast: () => {},
  refresh: async () => {},
  isPolling: false,
});

export function useNotifications() {
  return React.useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const pathname = usePathname();
  const openThreadId = getOpenThreadId(pathname);

  const userId = session?.user?.id ?? null;
  const mode = session?.mode ?? null;
  const isEnabled = shouldPollNotifications(mode, userId);

  // Rendered state is gated by identity to prevent old-data flash on A->B switch
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [toasts, setToasts] = React.useState<NotificationToastData[]>([]);
  const [isPolling, setIsPolling] = React.useState(false);

  const seenKeysRef = React.useRef<Set<string>>(new Set());
  const isInitializedRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const timeoutRef = React.useRef<number | null>(null);
  const intervalRef = React.useRef<number | null>(null);
  const generationRef = React.useRef(0);
  const fetchingGenerationRef = React.useRef<number | null>(null);
  // Identity generation fencing: captures which userId owned a given request
  const activeIdentityRef = React.useRef<string | null>(null);
  const openThreadIdRef = React.useRef<string | null>(openThreadId);
  const userIdRef = React.useRef<string | null>(userId);
  const isEnabledRef = React.useRef(isEnabled);

  React.useEffect(() => {
    openThreadIdRef.current = openThreadId;
    userIdRef.current = userId;
    isEnabledRef.current = isEnabled;
  }, [userId, openThreadId, isEnabled]);

  // Coalesce concurrent refresh calls: single in-flight promise
  const pendingRefreshRef = React.useRef<Promise<void> | null>(null);

  // Account isolation: identity switch clears rendered state and bumps generation immediately
  React.useEffect(() => {
    if (activeIdentityRef.current !== userId) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      fetchingGenerationRef.current = null;
      pendingRefreshRef.current = null;
      seenKeysRef.current = new Set();
      isInitializedRef.current = false;
      setToasts([]);
      setUnreadCount(0);
      setIsPolling(false);
      activeIdentityRef.current = userId;
      generationRef.current += 1;
    }
  }, [userId]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const doFetch = React.useCallback(async () => {
    if (!isEnabledRef.current || !userIdRef.current) return;
    if (fetchingGenerationRef.current !== null) return; // no overlap
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const requestGen = generationRef.current + 1;
    generationRef.current = requestGen;
    fetchingGenerationRef.current = requestGen;
    const capturedUserId = userIdRef.current;
    const capturedMode = mode;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Timeout guard: abort after 10s
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = window.setTimeout(() => {
      controller.abort();
    }, NOTIFICATION_POLL_TIMEOUT_MS);

    try {
      const res = await fetch("/api/notifications/summary", {
        cache: "no-store",
        signal: controller.signal,
        headers: { "Cache-Control": "no-store" },
      });

      // Discard if identity changed during await or if this request is stale
      if (controller.signal.aborted) return;
      if (requestGen !== generationRef.current) return;
      if (capturedUserId !== userIdRef.current) return;
      if (capturedUserId !== activeIdentityRef.current) return;

      if (!res.ok) {
        return;
      }

      const json = await res.json().catch(() => null);
      // Second fence after json await (important: old finally cannot clear newer lock, old data cannot apply)
      if (controller.signal.aborted) return;
      if (requestGen !== generationRef.current) return;
      if (capturedUserId !== userIdRef.current) return;

      if (!json || typeof json !== "object") return;
      // Demo guard via mode
      if ((json as { mode?: string }).mode === "demo") {
        if (capturedUserId === activeIdentityRef.current && requestGen === generationRef.current) {
          setUnreadCount(0);
        }
        return;
      }
      const data = (json as { data?: unknown }).data;
      const summary = parseNotificationSummary(data);
      if (!summary) {
        return;
      }

      // Gate rendered state by identity to prevent old-data flash
      if (capturedUserId !== activeIdentityRef.current) return;
      if (requestGen !== generationRef.current) return;

      setUnreadCount(summary.unreadCount);

      // Initial baseline suppression: first fetch seeds seen keys without toasting
      if (!isInitializedRef.current) {
        const nextSeen = new Set(seenKeysRef.current);
        for (const m of summary.messages) nextSeen.add(m.id);
        seenKeysRef.current = pruneSeenHistory(nextSeen, NOTIFICATION_SEEN_HISTORY_MAX);
        isInitializedRef.current = true;
        return;
      }

      // Stable ID dedupe + open-thread suppression + bounded seen history
      const openId = openThreadIdRef.current;
      const toastsToAdd: NotificationToastData[] = [];
      const nextSeen = new Set(seenKeysRef.current);
      for (const m of summary.messages) {
        if (openId && m.threadId === openId) continue;
        if (nextSeen.has(m.id)) continue;
        // Validate minimal: listingTitle etc already validated via Zod
        nextSeen.add(m.id);
        toastsToAdd.push({
          id: m.id,
          threadId: m.threadId,
          listingTitle: m.listingTitle,
          listingImageUrl: m.listingImageUrl,
          participantName: m.participantName,
          createdAt: m.createdAt,
          bodyPreview: null,
        });
        if (toastsToAdd.length >= NOTIFICATION_MAX_TOASTS) break;
      }

      seenKeysRef.current = pruneSeenHistory(nextSeen, NOTIFICATION_SEEN_HISTORY_MAX);

      if (toastsToAdd.length > 0) {
        setToasts((prev) => {
          const combined = [...toastsToAdd, ...prev];
          const seen = new Set<string>();
          const deduped: NotificationToastData[] = [];
          for (const t of combined) {
            if (!seen.has(t.id)) {
              seen.add(t.id);
              deduped.push(t);
            }
          }
          return deduped.slice(0, NOTIFICATION_MAX_TOASTS);
        });
      }
      void capturedMode;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Fence: only clear if this generation is still the active fetcher
      if (fetchingGenerationRef.current === requestGen) {
        fetchingGenerationRef.current = null;
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [mode]);

  const refresh = React.useCallback(async () => {
    if (pendingRefreshRef.current) {
      await pendingRefreshRef.current;
      return;
    }
    const p = doFetch();
    pendingRefreshRef.current = p;
    try {
      await p;
    } finally {
      if (pendingRefreshRef.current === p) pendingRefreshRef.current = null;
    }
  }, [doFetch]);

  // Polling lifecycle restarted per user identity (dependency includes userId)
  React.useEffect(() => {
    if (!isEnabled || !userId) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
      return;
    }

    void doFetch();

    const ensureInterval = () => {
      if (intervalRef.current !== null) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      intervalRef.current = window.setInterval(() => {
        void doFetch();
      }, NOTIFICATION_POLL_INTERVAL_MS);
      setIsPolling(true);
    };

    const clearIntervalSafe = () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
    };

    ensureInterval();

    const onFocus = () => {
      void doFetch();
      ensureInterval();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void doFetch();
        ensureInterval();
      } else {
        clearIntervalSafe();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearIntervalSafe();
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Do not clear fetchingGenerationRef here blindly; it will be fenced by generation
      // but we clear pending coalesce
      pendingRefreshRef.current = null;
    };
  }, [isEnabled, userId, doFetch]);

  const value = React.useMemo<NotificationsContextValue>(
    () => ({ unreadCount, toasts, dismissToast, refresh, isPolling }),
    [unreadCount, toasts, dismissToast, refresh, isPolling]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
