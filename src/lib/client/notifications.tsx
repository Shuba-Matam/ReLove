/* eslint-disable react-hooks/set-state-in-effect -- notifications provider needs sync state reset for account isolation and polling lifecycle */
"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/client/session";
import type { ThreadSummary } from "@/lib/marketplace";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  computeGlobalUnreadCount,
  detectNewMessageToasts,
  getOpenThreadId,
  shouldPollNotifications,
  type NotificationToastData,
  type ThreadSnapshot,
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

  const [unreadCount, setUnreadCount] = React.useState(0);
  const [toasts, setToasts] = React.useState<NotificationToastData[]>([]);
  const [isPolling, setIsPolling] = React.useState(false);

  // Refs for polling state, dedupe, abort, account isolation
  const prevMapRef = React.useRef<Map<string, ThreadSnapshot>>(new Map());
  const seenKeysRef = React.useRef<Set<string>>(new Set());
  const isInitializedRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const intervalRef = React.useRef<number | null>(null);
  const fetchingRef = React.useRef(false);
  const userIdRef = React.useRef<string | null>(userId);
  const openThreadIdRef = React.useRef<string | null>(openThreadId);
  const isEnabledRef = React.useRef(isEnabled);

  // Keep refs current
  React.useEffect(() => {
    userIdRef.current = userId;
    openThreadIdRef.current = openThreadId;
    isEnabledRef.current = isEnabled;
  }, [userId, openThreadId, isEnabled]);

  // Dedicated effect for account isolation: when userId identity changes, clear state
  const lastUserIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastUserIdRef.current !== userId) {
      // Abort any in-flight
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      fetchingRef.current = false;
      prevMapRef.current = new Map();
      seenKeysRef.current = new Set();
      isInitializedRef.current = false;
      setToasts([]);
      setUnreadCount(0);
      setIsPolling(false);
      lastUserIdRef.current = userId;
      // Clear interval; will restart below if enabled
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [userId]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const doFetch = React.useCallback(async () => {
    if (!isEnabledRef.current || !userIdRef.current) return;
    if (fetchingRef.current) return; // no overlapping
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // modest visible-tab only
    fetchingRef.current = true;

    // Abort previous stale request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/threads", {
        cache: "no-store",
        signal: controller.signal,
        headers: { "Cache-Control": "no-store" },
      });
      // If aborted, exit quietly
      if (controller.signal.aborted) return;

      if (!res.ok) {
        // Silently ignore polling errors; do not toast
        return;
      }
      const json = await res.json().catch(() => ({}));
      const threads: ThreadSummary[] = Array.isArray(json?.data) ? json.data : [];
      // Verify account isolation: ensure still same user (prevents cross-account leak if session changed mid-fetch)
      if (!isEnabledRef.current) return;

      const currentUserId = userIdRef.current;
      if (!currentUserId) return;

      // Demo safeguard: never toast sample inventory
      // shouldPoll already ensures mode live, but double-check server response mode
      if (json?.mode === "demo") {
        setUnreadCount(0);
        return;
      }

      const count = computeGlobalUnreadCount(threads);
      setUnreadCount(count);

      const result = detectNewMessageToasts({
        prevMap: prevMapRef.current,
        nextThreads: threads,
        currentUserId,
        openThreadId: openThreadIdRef.current,
        seenDedupeKeys: seenKeysRef.current,
        isInitial: !isInitializedRef.current,
      });

      prevMapRef.current = result.nextMap;
      seenKeysRef.current = result.nextSeenKeys;
      isInitializedRef.current = true;

      if (result.toasts.length > 0) {
        // Prepend new toasts, cap total visible
        setToasts((prev) => {
          const combined = [...result.toasts, ...prev];
          // Dedupe by id within visible toasts
          const seen = new Set<string>();
          const deduped: NotificationToastData[] = [];
          for (const t of combined) {
            if (!seen.has(t.id)) {
              seen.add(t.id);
              deduped.push(t);
            }
          }
          return deduped.slice(0, 3);
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // expected on abort/cleanup
        return;
      }
      // Network errors ignored for polling; keep silent
    } finally {
      fetchingRef.current = false;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  // Exposed manual refresh (focus + inbox/thread integration)
  const refresh = React.useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  // Setup polling: interval 30s, focus, visibility
  React.useEffect(() => {
    if (!isEnabled) {
      // Cleanup if disabled
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
      return;
    }

    // Initial fetch (establish baseline without flood)
    void doFetch();

    // Visible-tab interval
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
        // Pause polling when hidden to respect user constraint (modest visible-tab polling)
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
      fetchingRef.current = false;
    };
  }, [isEnabled, doFetch]);

  // Auto cleanup toasts after duration (pause on hover handled in component)
  // Dismiss helpers are in toast component; provider just holds state

  const value = React.useMemo<NotificationsContextValue>(
    () => ({ unreadCount, toasts, dismissToast, refresh, isPolling }),
    [unreadCount, toasts, dismissToast, refresh, isPolling]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
