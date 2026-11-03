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
      className="rounded-xl border border-[#021640]/60 bg-[#01071d] p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#020102] ring-1 ring-[#021640]">
          <Bell className="size-4 text-[#9AA4B8]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="push-optin-heading" className="text-sm font-medium text-[#F5F5F7]">
            Push notifications — coming soon
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">
            In-app toasts already notify you while the app is open.
          </p>
        </div>
      </div>
    </section>
  );
}
