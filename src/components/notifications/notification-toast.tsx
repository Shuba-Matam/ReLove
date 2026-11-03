"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type { NotificationToastData } from "@/lib/notifications";

export function NotificationToast({
  toast,
  onDismiss,
}: {
  toast: NotificationToastData;
  onDismiss: (id: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const timerRef = React.useRef<number | null>(null);
  const [paused, setPaused] = React.useState(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = React.useCallback(() => {
    clearTimer();
    if (paused) return;
    timerRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 8000);
  }, [clearTimer, onDismiss, paused, toast.id]);

  React.useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="group relative flex w-full max-w-[360px] items-center gap-3 rounded-xl border border-[#4a3025] bg-[#241712] p-3 pr-2 shadow-[0_8px_24px_rgba(0,0,0,0.6)] ring-1 ring-[#4a3025]/60 transition hover:border-[#ead7b7]/80 hover:shadow-[0_12px_32px_rgba(0,0,0,0.7)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Link
        href={`/inbox/${toast.threadId}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#241712]"
        onClick={() => {
          // Dismiss on navigation click
          onDismiss(toast.id);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={toast.listingImageUrl}
          alt=""
          aria-hidden="true"
          className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-[#4a3025]/50"
        />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium leading-5 text-[#f6ead8]">
            New message about {toast.listingTitle}
          </span>
          <span className="block truncate text-xs leading-4 text-[#bba995]">
            from {toast.participantName}
          </span>
          {toast.bodyPreview && (
            <span className="mt-0.5 hidden truncate text-xs leading-4 text-[#bba995] sm:block" aria-hidden="true">
              {toast.bodyPreview}
            </span>
          )}
        </span>
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#ead7b7] px-2.5 py-1 text-xs font-medium text-[#241712] sm:inline-flex">
          Open
        </span>
      </Link>
      <button
        type="button"
        aria-label={`Dismiss notification for ${toast.listingTitle}`}
        onClick={() => onDismiss(toast.id)}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[#bba995] transition hover:bg-[#1a100c] hover:text-[#f6ead8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#241712]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      {/* Progress bar for timeout; hidden when paused */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-xl bg-[#4a3025]/50"
      >
        <span
          className="block h-full bg-[#e6c79c] transition-all ease-linear"
          style={{
            width: paused ? "100%" : "0%",
            transitionDuration: paused ? "0ms" : "8000ms",
          }}
        />
      </span>
    </div>
  );
}
