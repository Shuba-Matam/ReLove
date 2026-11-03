const CACHE = "relove-shell-v1";
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

// --- Web-Push foundations (schema-independent, no sends yet) ---
// Verified browser support guidance in docs/NOTIFICATION-PROPOSAL.md.
// No permission prompt without user gesture; subscription storage requires owner-approved schema.

// Generic, privacy-safe push payload handling (no message bodies).
// Server will send only: { title, body: generic, threadId? } — never expose endpoints/keys to other users.
self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }

  // Validate generic payload; fallback to safe default.
  const title = (data && typeof data.title === "string" && data.title.trim().slice(0, 80)) || "New message on Re-Love";
  const body = (data && typeof data.body === "string" && data.body.trim().slice(0, 120)) || "You have a new message. Open Re-Love to view it.";
  const threadId = data && typeof data.threadId === "string" ? data.threadId : null;
  const url = threadId ? `/inbox/${threadId}` : "/inbox";

  // Generic notification — no message bodies, no sender email leakage.
  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url },
    tag: threadId ? `relove-thread-${threadId}` : "relove-inbox",
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/inbox";
  const fullUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing Re-Love tab if present; else open new.
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(fullUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(fullUrl);
        return null;
      })
  );
});

// Optional: handle push subscription change (browser rotates endpoint)
self.addEventListener("pushsubscriptionchange", () => {
  // No durable storage yet — requires owner-approved schema (docs proposal).
  // Future: re-subscribe and POST to /api/notifications/subscribe with VAPID p256dh/auth.
});
