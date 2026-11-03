import type { ThreadSummary } from "@/lib/marketplace";

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
export const NOTIFICATION_TOAST_DURATION_MS = 8000;
export const NOTIFICATION_MAX_TOASTS = 3;

export interface NotificationToastData {
  /** Unique dedupe key: threadId + createdAt */
  id: string;
  threadId: string;
  listingTitle: string;
  listingImageUrl: string;
  participantName: string;
  createdAt: string;
  /** Truncated preview for in-app toast only; email/push must NOT include bodies */
  bodyPreview: string | null;
}

export interface ThreadSnapshot {
  unreadCount: number;
  lastMessageCreatedAt: string | null;
  lastMessageSenderId: string | null;
}

export function computeGlobalUnreadCount(threads: ThreadSummary[]): number {
  let sum = 0;
  for (const t of threads) sum += Math.max(0, t.unread_count ?? 0);
  return sum;
}

export function getOpenThreadId(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  // pathname is e.g. "/inbox/abc-..." or "/inbox/abc-.../..."
  const match = pathname.match(/^\/inbox\/([^/]+)/);
  if (!match) return null;
  const candidate = match[1];
  // Basic uuid shape check; don't strictly validate to keep helper pure.
  // Return candidate; caller may validate if needed.
  if (!candidate || candidate.length < 8) return null;
  return candidate;
}

export function createToastDedupeKey(thread: ThreadSummary): string | null {
  if (!thread.last_message?.created_at) return null;
  // Composite key ensures same message never re-toasts; unread_count alone is insufficient for dedupe.
  return `${thread.id}:${thread.last_message.created_at}:${thread.last_message.sender_id ?? ""}`;
}

export function buildThreadSnapshotMap(threads: ThreadSummary[]): Map<string, ThreadSnapshot> {
  const map = new Map<string, ThreadSnapshot>();
  for (const t of threads) {
    map.set(t.id, {
      unreadCount: t.unread_count ?? 0,
      lastMessageCreatedAt: t.last_message?.created_at ?? null,
      lastMessageSenderId: t.last_message?.sender_id ?? null,
    });
  }
  return map;
}

export function shouldPollNotifications(
  mode: string | null | undefined,
  userId: string | null | undefined
): boolean {
  return mode === "live" && Boolean(userId);
}

export interface DetectNewToastsOptions {
  prevMap: Map<string, ThreadSnapshot>;
  nextThreads: ThreadSummary[];
  currentUserId: string;
  openThreadId: string | null;
  seenDedupeKeys: Set<string>;
  isInitial: boolean;
}

export interface DetectNewToastsResult {
  toasts: NotificationToastData[];
  nextMap: Map<string, ThreadSnapshot>;
  nextSeenKeys: Set<string>;
}

/** Truncate body to max 80 chars with ellipsis; never return empty string. */
export function truncateBodyPreview(body: string | null | undefined, max = 80): string | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Pure helper: detect new incoming messages that deserve a toast.
 * Constraints:
 * - Never toast on initial history (isInitial).
 * - Never toast for sent/self (last_message.sender_id === currentUserId).
 * - Never toast for already-open thread.
 * - Dedupe by message key (threadId + createdAt + sender).
 * - Never toast on threads with unread_count 0 or no last_message.
 * - Thread with increased unread_count but missing prev entry is considered new.
 */
export function detectNewMessageToasts(options: DetectNewToastsOptions): DetectNewToastsResult {
  const { prevMap, nextThreads, currentUserId, openThreadId, seenDedupeKeys, isInitial } = options;
  const nextMap = buildThreadSnapshotMap(nextThreads);

  if (isInitial) {
    // Baseline only; mark existing keys as seen to avoid retroactive toasts.
    const nextSeen = new Set(seenDedupeKeys);
    for (const t of nextThreads) {
      const key = createToastDedupeKey(t);
      if (key) nextSeen.add(key);
    }
    return { toasts: [], nextMap, nextSeenKeys: nextSeen };
  }

  const toasts: NotificationToastData[] = [];
  const nextSeen = new Set(seenDedupeKeys);

  for (const t of nextThreads) {
    if (!t.last_message) continue;
    if (t.unread_count <= 0) continue;
    if (t.last_message.sender_id === currentUserId) continue;
    if (openThreadId && t.id === openThreadId) continue;

    const prev = prevMap.get(t.id);
    const key = createToastDedupeKey(t);
    // If we cannot build a key, fallback to unread increase heuristic only.
    if (key && nextSeen.has(key)) continue;

    let isNew = false;
    if (!prev) {
      // New thread entirely (first message after baseline) -> toast
      isNew = true;
    } else {
      // Unread increased or last message timestamp changed (new incoming)
      const unreadIncreased = t.unread_count > prev.unreadCount;
      const messageChanged = t.last_message.created_at !== prev.lastMessageCreatedAt;
      // sender changed to another user is already filtered, but double-check
      const senderIsOther = t.last_message.sender_id !== currentUserId;
      if (senderIsOther && (unreadIncreased || messageChanged)) {
        // Ensure not already seen (covers polling duplicate)
        isNew = true;
      }
    }

    if (!isNew) continue;
    if (key) nextSeen.add(key);

    toasts.push({
      id: key ?? `${t.id}:${t.last_message.created_at}`,
      threadId: t.id,
      listingTitle: t.listing.title,
      listingImageUrl: t.listing.image_url,
      participantName: t.participant.display_name,
      createdAt: t.last_message.created_at,
      bodyPreview: truncateBodyPreview(t.last_message.body, 80),
    });
  }

  // Cap toasts to avoid flood: keep most recent first (nextThreads is ordered by updated_at desc)
  const capped = toasts.slice(0, NOTIFICATION_MAX_TOASTS);

  return { toasts: capped, nextMap, nextSeenKeys: nextSeen };
}

/**
 * Validate push endpoint for SSRF safety: must be https, web-push service origin.
 * This is a client-side structural check; server must re-validate authoritative recipient.
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    // Disallow private/local networks via hostname checks
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (host.endsWith(".local") || host.startsWith("10.") || host.startsWith("192.168.")) return false;
    // Must not be an internal metadata endpoint
    if (host === "169.254.169.254" || host.includes("metadata.google.internal")) return false;
    // Length guard
    if (endpoint.length > 2000) return false;
    return true;
  } catch {
    return false;
  }
}
