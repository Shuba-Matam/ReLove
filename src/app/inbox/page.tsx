"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/client/session";
import { useNotifications } from "@/lib/client/notifications";
import type { ThreadSummary } from "@/lib/marketplace";

export default function InboxPage() {
  const { session } = useSession();
  const { refresh: refreshNotifications } = useNotifications();
  const isDemo = session?.mode === "demo";
  const [threads, setThreads] = React.useState<ThreadSummary[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/threads", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load inbox");
      setThreads(json.data); setError("");
      // Keep global unread indicator in sync without duplicating polling logic
      void refreshNotifications();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inbox");
    } finally { setLoading(false); }
  }, [refreshNotifications]);

  React.useEffect(() => { const controller = new AbortController(); void (async () => { await Promise.resolve(); if(!controller.signal.aborted) await load(); })(); return () => controller.abort(); }, [load]);
  React.useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  if (isDemo) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl bg-[#32171a] p-8 text-center ring-1 ring-[#6b3434]">
        <h1 className="text-base font-semibold text-[#f6ead8]">Inbox demo</h1>
        <p className="mt-2 text-sm text-[#f1c7bd]">Messaging is read-only in demo. Sign in to send and receive.</p>
        <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/login">Sign in with Google</Link></Button>
      </div>
    );
  }

  if (!session?.user && !loading) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl bg-[#1a100c] p-8 text-center ring-1 ring-[#4a3025]/50">
        <h1 className="font-medium text-[#f6ead8]">Sign in to view messages</h1>
        <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="pb-2">
        <h1 className="text-xl font-semibold tracking-tight text-[#f6ead8]">Inbox</h1>
        <p className="mt-1 text-sm text-[#bba995]">Conversations about your listings.</p>
      </div>
      {loading && <p className="text-sm text-[#bba995]">Loading conversations…</p>}
      {error && <p role="alert" className="rounded-xl bg-[#32171a] p-3 text-sm leading-5 text-[#f1c7bd] ring-1 ring-[#6b3434]">{error}</p>}
      {threads && threads.length === 0 && <div className="py-10 text-center text-sm leading-6 text-[#bba995]">No conversations yet. Visit a listing and tap “Message seller”.</div>}
      {threads && threads.length > 0 && (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link key={t.id} href={`/inbox/${t.id}`} className="flex items-center gap-3 rounded-xl bg-[#1a100c] p-3 ring-1 ring-[#4a3025]/50 transition hover:ring-[#ead7b7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.listing.image_url} alt={t.listing.title} className="size-12 rounded-lg object-cover ring-1 ring-[#4a3025]/40" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#f6ead8]">{t.listing.title} · {t.participant.display_name}</p>
                <p className="truncate text-xs leading-5 text-[#bba995]">{t.last_message?.body ?? "No messages yet"}</p>
              </div>
              <div className="shrink-0 text-right">
                {t.unread_count > 0 && <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#ead7b7] text-xs font-medium text-[#241712]">{t.unread_count}</span>}
                <p className="mt-1 text-[11px] text-[#bba995]">{new Date(t.updated_at).toLocaleDateString()}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
