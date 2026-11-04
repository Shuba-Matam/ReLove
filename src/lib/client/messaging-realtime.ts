"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/marketplace";

export type MessagingConnection = "idle" | "connecting" | "connected" | "disconnected";
export type MessagingEvent = { kind: "message"; message: Message } | { kind: "connection"; status: MessagingConnection };
type Listener = (event: MessagingEvent) => void;
type Bootstrap = { url: string; publishableKey: string; accessToken: string; expiresAt: number; userId: string };

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "thread_id", "sender_id", "recipient_id", "body", "created_at"].every((key) => typeof row[key] === "string")
    && (row.read_at === null || typeof row.read_at === "string");
}

export class MessagingRealtimeController {
  private listeners = new Set<Listener>();
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient<any> | null = null;
  private ownerId: string | null = null;
  private generation = 0;
  private renewal: ReturnType<typeof setTimeout> | null = null;
  private status: MessagingConnection = "idle";
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) { this.fetchFn = fetchFn; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ kind: "connection", status: this.status });
    return () => this.listeners.delete(listener);
  }

  private emit(event: MessagingEvent) { for (const listener of this.listeners) listener(event); }
  private setStatus(status: MessagingConnection) { if (this.status !== status) { this.status = status; this.emit({ kind: "connection", status }); } }

  async connect(userId: string): Promise<void> {
    if (this.ownerId === userId && (this.status === "connecting" || this.status === "connected")) return;
    this.disconnect();
    const generation = ++this.generation;
    this.ownerId = userId;
    this.setStatus("connecting");
    try {
      const response = await this.fetchFn.call(globalThis, "/api/realtime/bootstrap", { cache: "no-store", headers: { "Cache-Control": "no-store" } });
      const payload = await response.json().catch(() => null) as { data?: Bootstrap } | null;
      if (!response.ok || !payload?.data || payload.data.userId !== userId || generation !== this.generation) throw new Error("Realtime unavailable");
      const bootstrap = payload.data;
      const client = createClient(bootstrap.url, bootstrap.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 20 } },
      });
      client.realtime.setAuth(bootstrap.accessToken);
      this.client = client;
      const channel = client.channel(`messages:${userId}`, { config: { private: true } });
      const onChange = (payload: { new: unknown }) => {
        if (generation !== this.generation || this.ownerId !== userId || !isMessage(payload.new)) return;
        const message = payload.new;
        if (message.sender_id !== userId && message.recipient_id !== userId) return;
        this.emit({ kind: "message", message });
      };
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` }, onChange)
        .subscribe((state) => {
          if (generation !== this.generation) return;
          if (state === "SUBSCRIBED") this.setStatus("connected");
          else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") this.setStatus("disconnected");
        });
      this.channel = channel;
      const renewIn = Math.max(15_000, bootstrap.expiresAt * 1000 - Date.now() - 60_000);
      this.renewal = setTimeout(() => { if (this.ownerId === userId) void this.connect(userId); }, renewIn);
    } catch {
      if (generation === this.generation) this.setStatus("disconnected");
    }
  }

  disconnect(): void {
    this.generation += 1;
    if (this.renewal) clearTimeout(this.renewal);
    this.renewal = null;
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.client?.realtime.disconnect();
    this.channel = null;
    this.client = null;
    this.ownerId = null;
    this.setStatus("idle");
  }
}
