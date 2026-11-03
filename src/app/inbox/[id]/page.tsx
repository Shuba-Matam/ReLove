"use client";
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/client/session";
import { useNotifications } from "@/lib/client/notifications";
import type { ThreadDetail } from "@/lib/marketplace";

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { refresh: refreshNotifications } = useNotifications();
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [olderLoading,setOlderLoading]=React.useState(false);
  async function loadOlder(){ if(!detail?.before) return; setOlderLoading(true); try { const response=await fetch(`/api/threads/${id}?before=${encodeURIComponent(detail.before)}`,{cache:"no-store"}); const result=await response.json(); if(!response.ok) throw new Error(result.error?.message || "Could not load earlier messages."); const previous=result.data as ThreadDetail; setDetail({...detail,has_more:previous.has_more,before:previous.before,messages:[...previous.messages,...detail.messages]}); } catch(error){setError(error instanceof Error ? error.message : "Could not load earlier messages.");} finally{setOlderLoading(false);} }
  const isDemo = session?.mode === "demo";
  const listRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/threads/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load thread");
      setDetail(json.data); setError("");
      // mark read (already-open thread should not toast)
      await fetch(`/api/threads/${id}/read`, { method: "POST" }).catch(()=>{});
      // Sync global badge: thread read reduces unread count
      void refreshNotifications();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, [id, refreshNotifications]);

  React.useEffect(() => { const controller = new AbortController(); void (async () => { await Promise.resolve(); if(!controller.signal.aborted) await load(); })(); return () => controller.abort(); }, [load]);
  React.useEffect(()=>{
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return ()=> window.removeEventListener("focus", onFocus);
  }, [load]);
  React.useEffect(()=>{ listRef.current?.scrollTo(0, listRef.current.scrollHeight); }, [detail?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || isDemo) return;
    setSending(true);
    try {
      const res = await fetch(`/api/threads/${id}/messages`, { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ body: body.trim() })});
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Send failed");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally { setSending(false); }
  }

  if (isDemo) {
    return <div className="mx-auto max-w-2xl rounded-xl bg-[#01071d] p-8 text-center ring-1 ring-[#021640]/40"><p className="text-sm text-[#9AA4B8]">Messaging disabled in demo. <Link href="/login" className="text-[#82b7ff] underline underline-offset-4">Sign in</Link> to chat.</p></div>;
  }

  if (loading) return <p className="text-sm text-[#9AA4B8]">Loading thread…</p>;
  if (error && !detail) return <p role="alert" className="rounded-xl bg-[#220815] p-3 text-sm text-[#f5c6d8] ring-1 ring-[#4a102f]">{error}</p>;
  if (!detail) return <p className="text-sm text-[#9AA4B8]">Thread not found.</p>;

  const me = session?.user?.id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col h-[68vh] overflow-hidden rounded-xl bg-[#020102] ring-1 ring-[#021640]/40">
      <header className="flex items-center gap-3 bg-[#020102] p-2.5">
        <Button variant="ghost" size="sm" onClick={()=>router.push("/inbox")} className="h-7">← Back</Button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={detail.thread.listing.image_url} alt={detail.thread.listing.title} className="size-8 rounded-lg object-cover ring-1 ring-[#021640]/40" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#F5F5F7]">{detail.thread.listing.title}</p>
          <p className="text-xs text-[#9AA4B8]">{detail.thread.participant.display_name}</p>
        </div>
        <Link href={`/listings/${detail.thread.listing.id}`} className="ml-auto text-xs font-medium text-[#82b7ff] underline decoration-[#03245e]/50 underline-offset-4 hover:text-[#93c5fd]">View listing</Link>
      </header>

      {detail.has_more && <div className="flex justify-center py-2"><Button variant="ghost" size="sm" disabled={olderLoading} onClick={loadOlder} className="h-7 text-xs">{olderLoading ? "Loading…" : "Earlier messages"}</Button></div>}
      <div ref={listRef} className="flex-1 overflow-y-auto bg-[#01071d]/50 p-3 space-y-2">
        {detail.messages.length===0 && <p className="text-center text-xs text-[#9AA4B8]">No messages yet. Say hello!</p>}
        {detail.messages.map((m)=>{
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end":"justify-start"}`}>
              <div className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-[#03245e] text-white rounded-br-sm" : "bg-[#020102] text-[#F5F5F7] rounded-bl-sm ring-1 ring-[#021640]/50"}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={`mt-1 text-[10px] ${mine ? "text-white/60":"text-[#9AA4B8]"}`}>{new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} {m.read_at ? "✓✓" : ""}</p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="px-3 py-2 text-sm text-[#f5c6d8]">{error}</p>}
      <form onSubmit={send} className="flex gap-2 bg-[#020102] p-2.5">
        <label htmlFor="msg-body" className="sr-only">Message</label>
        <Input id="msg-body" placeholder={isDemo ? "Demo — messaging disabled" : "Type a message…"} value={body} onChange={(e)=>setBody(e.target.value)} disabled={isDemo} className="flex-1 bg-[#01071d]" maxLength={2000} />
        <Button type="submit" variant="primary" size="sm" disabled={!body.trim() || sending || isDemo}>{sending ? "Sending…" : "Send"}</Button>
      </form>
    </div>
  );
}
