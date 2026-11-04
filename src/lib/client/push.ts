"use client";

/**
 * Web-push support detection only — no permission prompt, no subscription storage.
 * Durable subscriptions require owner-approved schema docs/drafts/004_notifications.sql (DEFAULT DISABLED).
 * UI shows "coming soon" until backend ready; no green-enabled claim.
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

function fromBase64Url(value:string):Uint8Array<ArrayBuffer>{ const padded=value.padEnd(Math.ceil(value.length/4)*4,"=").replace(/-/g,"+").replace(/_/g,"/"); const bytes=Uint8Array.from(atob(padded),(c)=>c.charCodeAt(0)); return bytes as Uint8Array<ArrayBuffer>; }
export async function enablePush():Promise<void>{
 const support=getPushSupport(); if(!support.supported) throw new Error(support.reason??"Push notifications are unavailable.");
 const permission=await requestPushPermissionFromUserGesture(); if(permission!=="granted") throw new Error(permission==="denied"?"Notifications are blocked in browser settings.":"Notification permission was not granted.");
 const configResponse=await fetch.call(globalThis,"/api/push/config",{cache:"no-store"}); const config=await configResponse.json(); const publicKey=config?.data?.publicKey; if(!configResponse.ok||typeof publicKey!=="string") throw new Error("Push notifications are not configured yet.");
 const registration=await navigator.serviceWorker.ready; let subscription=await registration.pushManager.getSubscription();
 if(!subscription) subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:fromBase64Url(publicKey)});
 const response=await fetch.call(globalThis,"/api/push/subscriptions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(subscription.toJSON())}); if(!response.ok){ await subscription.unsubscribe().catch(()=>false); const body=await response.json().catch(()=>null); throw new Error(body?.error?.message??"Could not enable notifications."); }
}
export async function disablePush():Promise<void>{ const registration=await navigator.serviceWorker.ready; const subscription=await registration.pushManager.getSubscription(); if(!subscription)return; await fetch.call(globalThis,"/api/push/subscriptions",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:subscription.endpoint})}); await subscription.unsubscribe(); }

/**
 * Validates endpoint for SSRF; re-export helper for client usage.
 */
export { isValidPushEndpoint } from "@/lib/notifications";
