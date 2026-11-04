const CACHE = "relove-shell-v2";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("relove-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network only for APIs, auth, and all user data. No offline write queue.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});

// --- Web-Push foundations (no sends, closed-app pending schema) ---
// Fixed generic content only — never trust payload title/body to avoid leakage.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }

  // Fixed generic title/body — always same, no message body leakage
  const title = "New message on Re-Love";
  const body = "You have a new message. Open Re-Love to view it.";

  let threadId = null;
  if (data && typeof data.threadId === "string" && UUID_RE.test(data.threadId)) {
    threadId = data.threadId;
  }
  const url = threadId ? `/inbox/${threadId}` : "/inbox";

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url },
    tag: data && typeof data.messageId === "string" && UUID_RE.test(data.messageId) ? `relove-message-${data.messageId}` : threadId ? `relove-thread-${threadId}` : "relove-inbox",
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/inbox";
  // Validate UUID in path and same-origin navigation; ignore invalid targets
  let targetPath = "/inbox";
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) {
      // Allow /inbox or /inbox/<uuid> only
      if (parsed.pathname === "/inbox") targetPath = "/inbox";
      else {
        const m = parsed.pathname.match(/^\/inbox\/([^/]+)/);
        if (m && UUID_RE.test(m[1])) targetPath = `/inbox/${m[1]}`;
      }
    }
  } catch {
    targetPath = "/inbox";
  }
  const fullUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          // Await navigate before focus to ensure correct page
          if ("navigate" in client) {
            try {
              await client.navigate(fullUrl);
            } catch {
              // navigate may fail; still focus
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(fullUrl);
      return null;
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  if (event.oldSubscription) event.waitUntil(fetch("/api/push/subscriptions", { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }) }).catch(() => undefined));
  // No durable storage yet — requires owner-approved schema (docs/drafts/004_notifications.sql).
});
