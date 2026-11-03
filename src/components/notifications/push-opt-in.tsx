"use client";

import { Bell, Info } from "lucide-react";

/**
 * Static informational card — no permission prompt, no stored endpoint.
 * Push remains disabled pending owner-approved schema (docs/drafts/004_notifications.sql).
 * This avoids SSR/client hydration mismatch and false "enabled" claims.
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
            Get notified even when Re-Love is closed. We&apos;re finishing secure push delivery — no action needed yet. In-app
            toasts already notify you while the app is open.
          </p>
          <p className="mt-3 inline-flex gap-2 rounded-lg bg-[#020102] px-2.5 py-1.5 text-xs leading-4 text-[#9AA4B8] ring-1 ring-[#021640]/50">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Closed-app push needs owner-approved setup. No push data is collected now. Email stays disabled pending a verified sender domain.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
