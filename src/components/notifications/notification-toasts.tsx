"use client";

import * as React from "react";
import { useNotifications } from "@/lib/client/notifications";
import { NotificationToast } from "./notification-toast";

export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="New message notifications"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 md:inset-x-auto md:bottom-5 md:right-5 md:items-end"
    >
      {/* Screen-reader live region text */}
      <span className="sr-only" aria-live="polite">
        {toasts.length === 1 ? `New message about ${toasts[0].listingTitle}` : `${toasts.length} new messages`}
      </span>
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-[360px]">
          <NotificationToast toast={t} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}
