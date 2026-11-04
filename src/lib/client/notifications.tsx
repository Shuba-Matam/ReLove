/* eslint-disable react-hooks/set-state-in-effect -- notifications provider needs sync state reset for account isolation and polling lifecycle */
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
import { useMessaging } from "@/lib/client/messaging";

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
  const messaging = useMessaging();
  // Key by identity ensures immediate render of zero state, independent of post-paint effects
  return (
    <NotificationsInner key={userId ?? "__anon__"} userId={userId} mode={mode} openThreadId={openThreadId} messaging={messaging}>
      {children}
    </NotificationsInner>
  );
}

function NotificationsInner({
  children,
  userId,
  mode,
  openThreadId,
  messaging,
}: {
  children: React.ReactNode;
  userId: string | null;
  mode: string | null;
  openThreadId: string | null;
  messaging: ReturnType<typeof useMessaging>;
}) {
  // State tagged with identity; gated at render so even if scheduler lags, visible value is zero when identity mismatches
  const [state, setState] = React.useState<NotificationControllerState>(() => createInitialNotificationState(userId));
  const [isPolling, setIsPolling] = React.useState(false);

  // Keep refs for stable scheduler callbacks without re-creating scheduler on thread change
  const userIdRef = React.useRef(userId);
  const modeRef = React.useRef(mode);
  const openThreadIdRef = React.useRef(openThreadId);
  React.useEffect(() => {
    userIdRef.current = userId;
    modeRef.current = mode;
    openThreadIdRef.current = openThreadId;
  }, [userId, mode, openThreadId]);

  const schedulerRef = React.useRef<NotificationPollScheduler | null>(null);

  // Safety for direct prop change without unmount in tests: switch identity if owner mismatches
  React.useEffect(() => {
    if (schedulerRef.current && state.ownerId !== userId) {
      schedulerRef.current.switchIdentity(userId);
    }
  }, [userId, state.ownerId]);

  // Polling lifecycle: fresh scheduler per effect setup, destroy only that instance on cleanup.
  // This survives React StrictMode setup->cleanup->setup: cleanup destroys old instance and only nulls ref if it still points to that instance.
  React.useEffect(() => {
    const scheduler = new NotificationPollScheduler(userId, {
      getUserId: () => userIdRef.current,
      getMode: () => modeRef.current,
      getOpenThreadId: () => openThreadIdRef.current,
      isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      onStateChange: (next) => {
        setState(next);
      },
    });
    schedulerRef.current = scheduler;

    // Sync React state when identity changed without key remount (tests). Keep functional update to avoid state dep.
    setState((prev) => (prev.ownerId === userId ? prev : createInitialNotificationState(userId)));

    if (!userId || mode !== "live") {
      setIsPolling(false);
      return () => {
        scheduler.destroy();
        if (schedulerRef.current === scheduler) {
          schedulerRef.current = null;
        }
      };
    }

    scheduler.start();
    setIsPolling(true);

    const onFocus = () => {
      scheduler.onFocus();
      setIsPolling(true);
    };
    const onVisibility = () => {
      scheduler.onVisibilityChange();
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
      scheduler.destroy();
      if (schedulerRef.current === scheduler) {
        schedulerRef.current = null;
      }
    };
  }, [userId, mode]);

  React.useEffect(() => messaging.subscribe((event) => {
    if (event.kind === "message") void schedulerRef.current?.refresh();
  }), [messaging]);

  React.useEffect(() => {
    const scheduler=schedulerRef.current;
    if(!scheduler) return;
    if(messaging.status === "connected") scheduler.clearIntervalSafe();
    else if(userId && mode === "live") scheduler.ensureInterval();
  }, [messaging.status,userId,mode]);

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
