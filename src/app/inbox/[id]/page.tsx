"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessaging } from "@/lib/client/messaging";
import { failedMessage, mergeMessages, type DisplayMessage } from "@/lib/client/messaging-state";
import { useNotifications } from "@/lib/client/notifications";
import { useSession } from "@/lib/client/session";
import type { Message, ThreadDetail } from "@/lib/marketplace";

async function browserFetch(input: RequestInfo | URL, init?: RequestInit) { return fetch.call(globalThis, input, init); }

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { status, subscribe } = useMessaging();
  const { refresh: refreshNotifications } = useNotifications();
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null);
  const [messages, setMessages] = React.useState<DisplayMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [body, setBody] = React.useState("");
  const [olderLoading, setOlderLoading] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const wasAtBottomRef = React.useRef(true);
  const generationRef = React.useRef(0);
  const requestsRef = React.useRef(new Set<AbortController>());
  const readCursorRef = React.useRef<Message | null>(null);
  const readRunningRef = React.useRef(false);
  const isDemo = session?.mode === "demo";
  const me = session?.user?.id;

  const markReadThrough = React.useCallback(async (message: Message) => {
    if (!me || message.recipient_id !== me || message.read_at || document.visibilityState !== "visible") return;
    const current = readCursorRef.current;
    if (!current || current.created_at < message.created_at || (current.created_at === message.created_at && current.id < message.id)) readCursorRef.current = message;
    if (readRunningRef.current) return;
    readRunningRef.current = true;
    const generation = generationRef.current;
    try {
      while (readCursorRef.current && generation === generationRef.current) {
        const cursor = readCursorRef.current;
        readCursorRef.current = null;
        const response = await browserFetch(`/api/threads/${id}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ through_created_at: cursor.created_at, through_id: cursor.id }),
        });
        if (!response.ok) throw new Error("Could not mark messages read.");
        if (generation === generationRef.current) {
          setMessages((currentMessages) => currentMessages.map((item) => item.recipient_id === me && !item.read_at && (item.created_at < cursor.created_at || (item.created_at === cursor.created_at && item.id <= cursor.id)) ? { ...item, read_at: new Date().toISOString() } : item));
          void refreshNotifications();
        }
      }
    } catch {
      // A later visibility/reconnect catch-up retries the authoritative cursor.
    } finally {
      readRunningRef.current = false;
      if (readCursorRef.current && generation === generationRef.current) void markReadThrough(readCursorRef.current);
    }
  }, [id, me, refreshNotifications]);

  const load = React.useCallback(async () => {
    const generation = generationRef.current;
    const controller = new AbortController();
    requestsRef.current.add(controller);
    try {
      const response = await browserFetch(`/api/threads/${id}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "Failed to load thread");
      if (generation !== generationRef.current) return;
      const next = result.data as ThreadDetail;
      setDetail(next);
      setMessages((current) => mergeMessages(current, next.messages));
      setError("");
      const lastReceived = [...next.messages].reverse().find((message) => message.recipient_id === me && !message.read_at);
      if (lastReceived) void markReadThrough(lastReceived);
    } catch (caught) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(caught instanceof Error ? caught.message : "Failed to load");
    } finally {
      requestsRef.current.delete(controller);
      if (generation === generationRef.current) setLoading(false);
    }
  }, [id, me, markReadThrough]);

  React.useEffect(() => {
    generationRef.current += 1;
    for (const request of requestsRef.current) request.abort();
    requestsRef.current.clear();
    readCursorRef.current = null;
    readRunningRef.current = false;
    setDetail(null);
    setMessages([]);
    setLoading(true);
    setError("");
    wasAtBottomRef.current = true;
    void load();
    return () => {
      generationRef.current += 1;
      for (const request of requestsRef.current) request.abort();
      requestsRef.current.clear();
    };
  }, [id, me, load]);
  React.useEffect(() => subscribe((event) => {
    if (event.kind !== "message" || event.message.thread_id !== id) return;
    setMessages((current) => mergeMessages(current, [event.message]));
    if (event.message.recipient_id === me) void markReadThrough(event.message);
  }), [id, markReadThrough, me, subscribe]);
  React.useEffect(() => { if (status === "connected") void load(); }, [status, load]);
  React.useEffect(() => {
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      void load();
      const lastIncoming = [...messages].reverse().find((message) => message.recipient_id === me && !message.read_at);
      if (lastIncoming) void markReadThrough(lastIncoming);
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [load, markReadThrough, me, messages]);
  React.useEffect(() => {
    if (status === "connected") return;
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => window.clearInterval(poll);
  }, [status, load]);
  React.useEffect(() => { const node=listRef.current; if(node && wasAtBottomRef.current) node.scrollTo({top:node.scrollHeight}); }, [messages.length]);

  async function loadOlder() {
    if (!detail?.before) return;
    setOlderLoading(true); setError("");
    const node = listRef.current; const oldHeight = node?.scrollHeight ?? 0;
    const generation = generationRef.current;
    const controller = new AbortController();
    requestsRef.current.add(controller);
    try {
      const response = await browserFetch(`/api/threads/${id}?before=${encodeURIComponent(detail.before)}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Could not load earlier messages.");
      if (generation !== generationRef.current) return;
      const previous = result.data as ThreadDetail;
      setMessages((current) => mergeMessages(previous.messages, current));
      setDetail((current) => current ? { ...current, has_more: previous.has_more, before: previous.before } : previous);
      requestAnimationFrame(() => { if (node) node.scrollTop += node.scrollHeight - oldHeight; });
    } catch (caught) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(caught instanceof Error ? caught.message : "Could not load earlier messages.");
    } finally {
      requestsRef.current.delete(controller);
      if (generation === generationRef.current) setOlderLoading(false);
    }
  }

  async function deliver(message: DisplayMessage) {
    const generation = generationRef.current;
    setMessages((current) => mergeMessages(current, [{ ...message, delivery: "pending", error: undefined }]));
    try {
      const response = await browserFetch(`/api/threads/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: message.body, client_action_id: message.client_action_id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "Send failed");
      if (generation !== generationRef.current) return;
      setMessages((current) => mergeMessages(current, [result.data as Message])); setError("");
    } catch (caught) {
      if (generation === generationRef.current) setMessages((current) => failedMessage(current, message.id, caught instanceof Error ? caught.message : "Send failed"));
    }
  }

  function send(event: React.FormEvent) {
    event.preventDefault(); const text=body.trim();
    if (!text || isDemo || !me || !detail) return;
    const actionId=crypto.randomUUID();
    const optimistic: DisplayMessage={ id:actionId,client_action_id:actionId,thread_id:id,sender_id:me,recipient_id:detail.thread.participant.id,body:text,created_at:new Date().toISOString(),read_at:null,delivery:"pending" };
    setBody(""); void deliver(optimistic);
  }

  if (isDemo) return <div className="mx-auto max-w-2xl rounded-xl bg-[#241712] p-8 text-center ring-1 ring-[#4a3025]/40"><p className="text-sm text-[#bba995]">Messaging disabled in demo. <Link href="/login" className="text-[#ead7b7] underline underline-offset-4">Sign in</Link> to chat.</p></div>;
  if (loading) return <p className="text-sm text-[#bba995]">Loading thread...</p>;
  if (error && !detail) return <p role="alert" className="rounded-xl bg-[#32171a] p-3 text-sm text-[#f1c7bd] ring-1 ring-[#6b3434]">{error}</p>;
  if (!detail) return <p className="text-sm text-[#bba995]">Thread not found.</p>;

  return <div className="mx-auto flex h-[68vh] max-w-3xl flex-col overflow-hidden rounded-xl bg-[#1a100c] ring-1 ring-[#4a3025]/40">
    <header className="flex items-center gap-3 bg-[#1a100c] p-2.5"><Button variant="ghost" size="sm" onClick={() => router.push("/inbox")} className="h-7">Back</Button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={detail.thread.listing.image_url} alt={detail.thread.listing.title} className="size-8 rounded-lg object-cover ring-1 ring-[#4a3025]/40" />
      <div className="min-w-0"><p className="truncate text-sm font-medium text-[#f6ead8]">{detail.thread.listing.title}</p><p className="text-xs text-[#bba995]">{detail.thread.participant.display_name}</p></div>
      <Link href={`/listings/${detail.thread.listing.id}`} className="ml-auto text-xs font-medium text-[#ead7b7] underline underline-offset-4">View listing</Link></header>
    {detail.has_more && <div className="flex justify-center py-2"><Button variant="ghost" size="sm" disabled={olderLoading} onClick={loadOlder} className="h-7 text-xs">{olderLoading ? "Loading..." : "Earlier messages"}</Button></div>}
    <div ref={listRef} onScroll={(event) => { const node=event.currentTarget; wasAtBottomRef.current=node.scrollHeight-node.scrollTop-node.clientHeight<80; }} className="flex-1 space-y-2 overflow-y-auto bg-[#241712]/50 p-3">
      {messages.length===0 && <p className="text-center text-xs text-[#bba995]">No messages yet. Say hello!</p>}
      {messages.map((message) => { const mine=message.sender_id===me; return <div key={message.id} className={`flex ${mine?"justify-end":"justify-start"}`}><div className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm ${mine?"rounded-br-sm bg-[#ead7b7] text-[#241712]":"rounded-bl-sm bg-[#1a100c] text-[#f6ead8] ring-1 ring-[#4a3025]/50"}`}>
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p><div className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${mine?"text-[#6b5142]":"text-[#bba995]"}`}><span>{new Date(message.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} {message.read_at?"Read":""}</span>{message.delivery==="pending"&&<span>Sending...</span>}{message.delivery==="failed"&&<button type="button" className="font-semibold underline" onClick={() => void deliver(message)}>Retry</button>}</div>
        {message.delivery==="failed"&&<p role="alert" className="mt-1 text-[11px] text-[#7f1d1d]">{message.error}</p>}</div></div>; })}
    </div>
    {error&&<p role="alert" className="px-3 py-2 text-sm text-[#f1c7bd]">{error}</p>}
    <form onSubmit={send} className="flex gap-2 bg-[#1a100c] p-2.5"><label htmlFor="msg-body" className="sr-only">Message</label><Input id="msg-body" placeholder="Type a message..." value={body} onChange={(event)=>setBody(event.target.value)} className="flex-1 bg-[#241712]" maxLength={2000}/><Button type="submit" variant="primary" size="sm" disabled={!body.trim()}>Send</Button></form>
  </div>;
}
