"use client";

import { Bell } from "lucide-react";

/**
 * Static informational card — no permission prompt, no stored endpoint.
 * Push is disabled; static short copy only.
 */
export function PushOptInCard() {
  return (
    <section
      aria-labelledby="push-optin-heading"
      className="rounded-xl border border-[#4a3025]/60 bg-[#241712] p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1a100c] ring-1 ring-[#4a3025]">
          <Bell className="size-4 text-[#bba995]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="push-optin-heading" className="text-sm font-medium text-[#f6ead8]">
            Push notifications, coming soon
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#bba995]">
            In-app toasts already notify you while the app is open.
          </p>
        </div>
      </div>
    </section>
  );
}
