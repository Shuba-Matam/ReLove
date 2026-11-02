"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/client/session";
import type { ThreadSummary } from "@/lib/marketplace";

export default function InboxPage() {
  const { session } = useSession();
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load inbox");
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { const controller = new AbortController(); void (async () => { await Promise.resolve(); if(!controller.signal.aborted) await load(); })(); return () => controller.abort(); }, [load]);
  React.useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  if (isDemo) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl bg-[#220815] p-8 text-center ring-1 ring-[#4a102f]">
        <h1 className="text-base font-semibold text-[#F5F5F7]">Inbox — demo</h1>
        <p className="mt-2 text-sm text-[#f5c6d8]">Messaging is read-only in demo. Sign in to send and receive.</p>
        <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/login">Sign in with Google</Link></Button>
      </div>
    );
  }

  if (!session?.user && !loading) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl bg-[#020102] p-8 text-center ring-1 ring-[#021640]/50">
        <h1 className="font-medium text-[#F5F5F7]">Sign in to view messages</h1>
        <Button asChild variant="primary" size="sm" className="mt-4"><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="pb-2">
        <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F7]">Inbox</h1>
        <p className="mt-1 text-sm text-[#9AA4B8]">Conversations about your listings.</p>
      </div>
      {loading && <p className="text-sm text-[#9AA4B8]">Loading conversations…</p>}
      {error && <p role="alert" className="rounded-xl bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8] ring-1 ring-[#4a102f]">{error}</p>}
      {threads && threads.length === 0 && <div className="py-10 text-center text-sm leading-6 text-[#9AA4B8]">No conversations yet. Visit a listing and tap “Message seller”.</div>}
      {threads && threads.length > 0 && (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link key={t.id} href={`/inbox/${t.id}`} className="flex items-center gap-3 rounded-xl bg-[#020102] p-3 ring-1 ring-[#021640]/50 transition hover:ring-[#03245e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.listing.image_url} alt={t.listing.title} className="size-12 rounded-lg object-cover ring-1 ring-[#021640]/40" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#F5F5F7]">{t.listing.title} — {t.participant.display_name}</p>
                <p className="truncate text-xs leading-5 text-[#9AA4B8]">{t.last_message?.body ?? "No messages yet"}</p>
              </div>
              <div className="shrink-0 text-right">
                {t.unread_count > 0 && <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#03245e] text-xs font-medium text-white">{t.unread_count}</span>}
                <p className="mt-1 text-[11px] text-[#9AA4B8]">{new Date(t.updated_at).toLocaleDateString()}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
