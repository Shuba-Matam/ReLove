/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs -- notifications provider needs sync state reset for account isolation and polling lifecycle */
"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/client/session";
import { getOpenThreadId } from "@/lib/notifications";
import {
  NotificationPollScheduler,
  createInitialNotificationState,
  type NotificationControllerState,
} from "@/lib/client/notifications-controller";
import type { NotificationToastData } from "@/lib/notifications";

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

// Outer provider: keyed so identity switch unmounts inner and renders zero immediately without effect
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const pathname = usePathname();
  const userId = session?.user?.id ?? null;
  const mode = session?.mode ?? null;
  const openThreadId = getOpenThreadId(pathname);
  // Key by identity ensures immediate render of zero state, independent of post-paint effects
  return (
    <NotificationsInner key={userId ?? "__anon__"} userId={userId} mode={mode} openThreadId={openThreadId}>
      {children}
    </NotificationsInner>
  );
}

function NotificationsInner({
  children,
  userId,
  mode,
  openThreadId,
}: {
  children: React.ReactNode;
  userId: string | null;
  mode: string | null;
  openThreadId: string | null;
}) {
  // State tagged with identity; gated at render so even if scheduler lags, visible value is zero when identity mismatches
  const [state, setState] = React.useState<NotificationControllerState>(() => createInitialNotificationState(userId));
  const [isPolling, setIsPolling] = React.useState(false);

  // Keep refs for deps
  const userIdRef = React.useRef(userId);
  const modeRef = React.useRef(mode);
  const openThreadIdRef = React.useRef(openThreadId);
  React.useEffect(() => {
    userIdRef.current = userId;
    modeRef.current = mode;
    openThreadIdRef.current = openThreadId;
  }, [userId, mode, openThreadId]);

  const schedulerRef = React.useRef<NotificationPollScheduler | null>(null);
  if (schedulerRef.current == null) {
    schedulerRef.current = new NotificationPollScheduler(userId, {
      getUserId: () => userIdRef.current,
      getMode: () => modeRef.current,
      getOpenThreadId: () => openThreadIdRef.current,
      isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      onStateChange: (next) => {
        setState(next);
      },
    });
  }

  // If key didn't remount but userId prop changed due to null->value without key? Key handles most, but also handle sync switch as safety
  // This guards against React not remounting when userId goes null->null? No, key is __anon__ for null. Switch null->real will remount. So this is redundant but keep for direct prop change without unmount in tests
  React.useEffect(() => {
    if (schedulerRef.current && state.ownerId !== userId) {
      schedulerRef.current.switchIdentity(userId);
    }
  }, [userId, state.ownerId]);

  // Polling lifecycle per identity
  React.useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    // If not enabled, ensure no interval
    if (!userId || mode !== "live") {
      scheduler.clearIntervalSafe();
      setIsPolling(false);
      return;
    }

    scheduler.start();
    // Derive polling flag from interval existence; start sets interval if enabled
    setIsPolling(true);

    const onFocus = () => {
      scheduler.onFocus();
      setIsPolling(true);
    };
    const onVisibility = () => {
      scheduler.onVisibilityChange();
      // isHidden check inside; polling flag reflects interval presence
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        setIsPolling(false);
      } else {
        setIsPolling(true);
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.clearIntervalSafe();
      setIsPolling(false);
      // Invalidate generation/cancel fetch so stale work cannot update state after unmount
      scheduler.destroy();
      // Recreate scheduler for potential remount with same key? But key will remount anyway.
      // Reset ref so next mount creates fresh scheduler
      schedulerRef.current = null;
    };
  }, [userId, mode]);

  const dismissToast = React.useCallback((id: string) => {
    schedulerRef.current?.dismissToast(id);
  }, []);

  const refresh = React.useCallback(async () => {
    await schedulerRef.current?.refresh();
  }, []);

  const value = React.useMemo<NotificationsContextValue>(() => {
    const isCurrent = state.ownerId === userId;
    return {
      unreadCount: isCurrent ? state.unreadCount : 0,
      toasts: isCurrent ? state.toasts : [],
      dismissToast,
      refresh,
      isPolling,
    };
  }, [state, userId, dismissToast, refresh, isPolling]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
