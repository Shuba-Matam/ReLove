import { z } from "zod";

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
export const NOTIFICATION_POLL_TIMEOUT_MS = 10_000;
export const NOTIFICATION_TOAST_DURATION_MS = 8000;
export const NOTIFICATION_MAX_TOASTS = 3;
export const NOTIFICATION_SEEN_HISTORY_MAX = 200;
export const NOTIFICATION_MESSAGES_LIMIT = 20;

export interface NotificationToastData {
  /** Stable dedupe key: message id (UUID) */
  id: string;
  threadId: string;
  listingTitle: string;
  listingImageUrl: string;
  participantName: string;
  createdAt: string;
  bodyPreview: string | null;
}

export function getOpenThreadId(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/inbox\/([^/]+)/);
  if (!match) return null;
  const candidate = match[1];
  if (!candidate || candidate.length < 8) return null;
  return candidate;
}

export function shouldPollNotifications(mode: string | null | undefined, userId: string | null | undefined): boolean {
  return mode === "live" && Boolean(userId);
}

// --- New efficient summary types (authenticated, no-store, no per-thread queries) ---

export const notificationMessageSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  createdAt: z.string().datetime(),
  listingTitle: z.string().min(1).max(200),
  listingImageUrl: z.string().min(1).max(1000),
  participantName: z.string().min(1).max(100),
});

export const notificationSummarySchema = z.object({
  unreadCount: z.number().int().min(0).max(100000),
  messages: z.array(notificationMessageSchema).max(NOTIFICATION_MESSAGES_LIMIT),
});

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;
export type NotificationSummary = z.infer<typeof notificationSummarySchema>;

export function parseNotificationSummary(data: unknown): NotificationSummary | null {
  const parsed = notificationSummarySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function pruneSeenHistory(set: Set<string>, maxSize: number): Set<string> {
  if (set.size <= maxSize) return set;
  const pruned = new Set<string>();
  // Keep most recent maxSize entries; Set iteration is insertion order, so skip oldest
  const toSkip = set.size - maxSize;
  let i = 0;
  for (const v of set) {
    if (i >= toSkip) pruned.add(v);
    i++;
  }
  return pruned;
}

// --- Push endpoint validation (strict allowlist) ---

// Official push service hosts only — verified 2026-11:
// FCM (Chrome/Edge): fcm.googleapis.com
// Mozilla (Firefox): updates.push.services.mozilla.com
// Apple (Safari): web.push.apple.com, api.push.apple.com
const PUSH_ALLOWLIST_HOSTS = new Set<string>([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "api.push.apple.com",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate push endpoint for SSRF safety.
 * Strict allowlist: https only, port 443 implicit, no credentials, no fragment, exact host allowlist.
 * Sender must also enforce redirect:error and final destination checks (server-side).
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  try {
    if (endpoint.length > 2000) return false;
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.hash) return false;
    // Only default https port allowed (empty port means 443)
    if (url.port && url.port !== "443") return false;
    const host = url.hostname.toLowerCase();
    // Reject IP literals and private/local explicitly (allowlist will also reject, but fast-fail)
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return false;
    if (host.startsWith("10.") || host.startsWith("192.168.") || host === "169.254.169.254" || host.includes("metadata.google.internal")) return false;
    // Exact allowlist — no wildcards
    if (!PUSH_ALLOWLIST_HOSTS.has(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isValidThreadId(id: string): boolean {
  return UUID_RE.test(id);
}

export function coerceNotificationToastFromMessage(
  msg: NotificationMessage,
  mode: string | null | undefined,
  currentUserId: string | null,
  openThreadId: string | null,
  seenKeys: Set<string>
): NotificationToastData | null {
  if (mode === "demo") return null;
  if (!currentUserId) return null;
  if (openThreadId && msg.threadId === openThreadId) return null;
  if (seenKeys.has(msg.id)) return null;
  // Basic validation: ensure UUIDs valid
  if (!isValidThreadId(msg.threadId) || !isValidThreadId(msg.id)) return null;
  return {
    id: msg.id,
    threadId: msg.threadId,
    listingTitle: msg.listingTitle,
    listingImageUrl: msg.listingImageUrl,
    participantName: msg.participantName,
    createdAt: msg.createdAt,
    bodyPreview: null, // summary never carries bodies
  };
}

export function getPushAllowlistHosts(): string[] {
  return Array.from(PUSH_ALLOWLIST_HOSTS);
}
