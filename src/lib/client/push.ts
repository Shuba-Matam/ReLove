"use client";

/**
 * Schema-independent web-push foundations.
 * No permission prompt without user gesture. No external sends yet.
 * See docs/NOTIFICATION-PROPOSAL.md for durable subscription schema awaiting owner approval.
 */

export type PushSupport = {
  supported: boolean;
  reason: string | null;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  secureContext: boolean;
};

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, reason: "Server rendering", serviceWorker: false, pushManager: false, notification: false, secureContext: false };
  }
  const secureContext = window.isSecureContext;
  const serviceWorker = "serviceWorker" in navigator;
  const pushManager = serviceWorker && "PushManager" in window;
  const notification = "Notification" in window;
  if (!secureContext) return { supported: false, reason: "Requires HTTPS (secure context)", serviceWorker, pushManager, notification, secureContext };
  if (!serviceWorker) return { supported: false, reason: "Service Worker not available in this browser", serviceWorker, pushManager, notification, secureContext };
  if (!pushManager) return { supported: false, reason: "PushManager not available", serviceWorker, pushManager, notification, secureContext };
  if (!notification) return { supported: false, reason: "Notifications not available", serviceWorker, pushManager, notification, secureContext };
  return { supported: true, reason: null, serviceWorker, pushManager, notification, secureContext };
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Must be called from a user click handler. Never auto-prompt.
 * Returns permission after request, or current state if not requesting.
 */
export async function requestPushPermissionFromUserGesture(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") return Notification.permission;
  const result = await Notification.requestPermission();
  return result;
}

/**
 * Validates endpoint for SSRF; re-export helper for client usage.
 */
export { isValidPushEndpoint } from "@/lib/notifications";
