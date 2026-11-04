"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/lib/marketplace";

export type MessagingConnection = "idle" | "connecting" | "connected" | "disconnected";
export type MessagingEvent = { kind: "message"; message: Message } | { kind: "connection"; status: MessagingConnection };
type Listener = (event: MessagingEvent) => void;
type Bootstrap = { url: string; publishableKey: string; accessToken: string; expiresAt: number; userId: string };
type Timer = ReturnType<typeof setTimeout>;

export type MessagingRealtimeDeps = {
  fetchFn?: typeof fetch;
  createClientFn?: typeof createClient;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => number;
};

const BOOTSTRAP_TIMEOUT_MS = 8_000;
const MAX_RETRY_MS = 30_000;

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "thread_id", "sender_id", "recipient_id", "body", "created_at"].every((key) => typeof row[key] === "string")
    && (row.read_at === null || typeof row.read_at === "string");
}

export class MessagingRealtimeController {
  private listeners = new Set<Listener>();
  private channel: RealtimeChannel | null = null;
  private client: SupabaseClient | null = null;
  private ownerId: string | null = null;
  private generation = 0;
  private renewal: Timer | null = null;
  private retry: Timer | null = null;
  private retryAttempt = 0;
  private status: MessagingConnection = "idle";
  private readonly deps: Required<MessagingRealtimeDeps>;

  constructor(fetchOrDeps: typeof fetch | MessagingRealtimeDeps = {}) {
    const deps = typeof fetchOrDeps === "function" ? { fetchFn: fetchOrDeps } : fetchOrDeps;
    this.deps = {
      fetchFn: deps.fetchFn ?? fetch,
      createClientFn: deps.createClientFn ?? createClient,
      setTimeoutFn: deps.setTimeoutFn ?? setTimeout,
      clearTimeoutFn: deps.clearTimeoutFn ?? clearTimeout,
      now: deps.now ?? Date.now,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ kind: "connection", status: this.status });
    return () => this.listeners.delete(listener);
  }

  private emit(event: MessagingEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: MessagingConnection, force = false) {
    if (this.status !== status || force) {
      this.status = status;
      this.emit({ kind: "connection", status });
    }
  }

  private clearTimer(timer: Timer | null): null {
    if (timer) this.deps.clearTimeoutFn(timer);
    return null;
  }

  private async fetchBootstrap(userId: string, generation: number): Promise<Bootstrap> {
    const controller = new AbortController();
    const timeout = this.deps.setTimeoutFn(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
    try {
      const response = await this.deps.fetchFn.call(globalThis, "/api/realtime/bootstrap", {
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { data?: Bootstrap } | null;
      if (!response.ok || !payload?.data || payload.data.userId !== userId || generation !== this.generation) throw new Error("Realtime unavailable");
      return payload.data;
    } finally {
      this.deps.clearTimeoutFn(timeout);
    }
  }

  private scheduleRenewal(userId: string, expiresAt: number, generation: number) {
    this.renewal = this.clearTimer(this.renewal);
    const delay = Math.max(15_000, expiresAt * 1000 - this.deps.now() - 60_000);
    this.renewal = this.deps.setTimeoutFn(() => {
      if (this.ownerId === userId && this.generation === generation) void this.renewAuth(userId, generation);
    }, delay);
  }

  private scheduleRetry(userId: string, generation: number) {
    if (this.retry || this.ownerId !== userId || this.generation !== generation) return;
    const delay = Math.min(MAX_RETRY_MS, 1_000 * (2 ** Math.min(this.retryAttempt, 5)));
    this.retryAttempt += 1;
    this.retry = this.deps.setTimeoutFn(() => {
      this.retry = null;
      if (this.ownerId === userId && this.generation === generation) void this.openConnection(userId, generation);
    }, delay);
  }

  private async renewAuth(userId: string, generation: number) {
    try {
      const bootstrap = await this.fetchBootstrap(userId, generation);
      if (!this.client || this.ownerId !== userId || this.generation !== generation) return;
      await this.client.realtime.setAuth(bootstrap.accessToken);
      this.scheduleRenewal(userId, bootstrap.expiresAt, generation);
    } catch {
      if (this.ownerId === userId && this.generation === generation) {
        this.setStatus("disconnected");
        this.scheduleRetry(userId, generation);
      }
    }
  }

  private releaseSocket() {
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.client?.realtime.disconnect();
    this.channel = null;
    this.client = null;
  }

  private async openConnection(userId: string, generation: number): Promise<void> {
    if (this.ownerId !== userId || generation !== this.generation) return;
    this.setStatus("connecting");
    this.releaseSocket();
    try {
      const bootstrap = await this.fetchBootstrap(userId, generation);
      const client = this.deps.createClientFn(bootstrap.url, bootstrap.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 20 } },
      });
      await client.realtime.setAuth(bootstrap.accessToken);
      if (this.ownerId !== userId || generation !== this.generation) {
        client.realtime.disconnect();
        return;
      }
      this.client = client;
      const channel = client.channel(`messages:${userId}`);
      const onChange = (payload: { new: unknown }) => {
        if (generation !== this.generation || this.ownerId !== userId || !isMessage(payload.new)) return;
        const message = payload.new;
        if (message.sender_id === userId || message.recipient_id === userId) this.emit({ kind: "message", message });
      };
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` }, onChange)
        .subscribe((state) => {
          if (generation !== this.generation || this.ownerId !== userId) return;
          if (state === "SUBSCRIBED") {
            this.retryAttempt = 0;
            this.retry = this.clearTimer(this.retry);
            this.setStatus("connected", true);
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            this.setStatus("disconnected");
            this.scheduleRetry(userId, generation);
          }
        });
      this.channel = channel;
      this.scheduleRenewal(userId, bootstrap.expiresAt, generation);
    } catch {
      if (generation === this.generation && this.ownerId === userId) {
        this.setStatus("disconnected");
        this.scheduleRetry(userId, generation);
      }
    }
  }

  async connect(userId: string): Promise<void> {
    if (this.ownerId === userId && (this.status === "connecting" || this.status === "connected")) return;
    this.disconnect();
    this.ownerId = userId;
    await this.openConnection(userId, this.generation);
  }

  catchUp(): void {
    const userId = this.ownerId;
    if (!userId || this.status === "connecting") return;
    if (this.status === "connected") {
      this.setStatus("connected", true);
      return;
    }
    this.retry = this.clearTimer(this.retry);
    void this.openConnection(userId, this.generation);
  }

  disconnect(): void {
    this.generation += 1;
    this.renewal = this.clearTimer(this.renewal);
    this.retry = this.clearTimer(this.retry);
    this.retryAttempt = 0;
    this.releaseSocket();
    this.ownerId = null;
    this.setStatus("idle");
  }
}
