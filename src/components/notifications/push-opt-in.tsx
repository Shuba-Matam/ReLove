"use client";

import * as React from "react";
import { Bell, BellOff, CheckCircle2, Info } from "lucide-react";
import { getPushSupport, getPushPermission, requestPushPermissionFromUserGesture } from "@/lib/client/push";
import { Button } from "@/components/ui/button";

/**
 * Schema-independent guidance UI. Does not auto-prompt.
 * Durable subscription storage requires owner-approved schema (see docs proposal).
 */
export function PushOptInCard() {
  const [support, setSupport] = React.useState(() => getPushSupport());
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">(() => getPushPermission());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // Refresh permission if user changes it in browser settings (visibility)
    const onFocus = () => {
      setSupport(getPushSupport());
      setPermission(getPushPermission());
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const handleRequest = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestPushPermissionFromUserGesture();
      setPermission(result);
      setSupport(getPushSupport());
    } finally {
      setBusy(false);
    }
  };

  const isBlocked = permission === "denied";
  const isGranted = permission === "granted";
  const canRequest = support.supported && permission === "default";

  return (
    <section
      aria-labelledby="push-optin-heading"
      className="rounded-xl border border-[#021640]/60 bg-[#01071d] p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#020102] ring-1 ring-[#021640]">
          {isGranted ? <CheckCircle2 className="size-4 text-[#60a5fa]" /> : isBlocked ? <BellOff className="size-4 text-[#9AA4B8]" /> : <Bell className="size-4 text-[#9AA4B8]" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="push-optin-heading" className="text-sm font-medium text-[#F5F5F7]">
            Push notifications {isGranted ? "(enabled)" : isBlocked ? "(blocked)" : "(coming soon)"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">
            {isGranted
              ? "You enabled browser notifications. Full push delivery (closed-app) requires owner-approved server setup — no messages are sent yet."
              : isBlocked
                ? "Notifications are blocked in your browser settings. Unblock in site settings to allow future opt-in."
                : "Get notified even when Re-Love is closed. Requires your explicit click — we never auto-prompt."}
          </p>

          {!support.supported && (
            <p role="status" className="mt-2 inline-flex gap-2 rounded-lg bg-[#020102] px-2.5 py-1.5 text-xs leading-4 text-[#9AA4B8] ring-1 ring-[#021640]/50">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>Push not supported: {support.reason} — in-app toasts still work while the app is open.</span>
            </p>
          )}

          {isGranted && (
            <p className="mt-2 text-xs leading-4 text-[#9AA4B8]">
              Foundation ready. Server-side VAPID subscriptions and delivery will be added after schema approval. No endpoint is stored yet.
            </p>
          )}

          {canRequest && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={handleRequest} disabled={busy} className="rounded-full">
                {busy ? "Requesting…" : "Enable browser notifications"}
              </Button>
              <span className="inline-flex items-center text-[11px] leading-4 text-[#9AA4B8]">You can revoke anytime in browser settings.</span>
            </div>
          )}

          {!support.supported && permission === "unsupported" && (
            <p className="mt-2 text-[11px] leading-4 text-[#9AA4B8]">
              Verified support: HTTPS required, Service Worker + PushManager + Notification APIs. See docs/NOTIFICATION-PROPOSAL.md for exact setup and browser guidance.
            </p>
          )}

          <p className="mt-3 text-[11px] leading-4 text-[#9AA4B8]">
            Pending owner approval: push subscriptions, outbox, and email preferences schema. No external sends yet.{" "}
            <a href="/docs-notifications" className="underline decoration-[#03245e] underline-offset-4 hover:text-[#F5F5F7] hidden" aria-hidden="true">
              Docs
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
