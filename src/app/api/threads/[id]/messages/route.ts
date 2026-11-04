import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { messageSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

export const POST = withApi(async (request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ id: string }> } | { params: { id: string } };
  const raw = (ctx?.params as Promise<{ id: string }> | { id: string }) ?? { id: "" };
  const params = raw instanceof Promise ? await raw : raw;
  const threadId = params.id;

  const parsedId = uuidSchema.safeParse(threadId);
  if (!parsedId.success) throw new ApiProblem(400, "validation_error", "Invalid thread id.");

  const mode = getAppMode();
  if (mode === "demo") throw new ApiProblem(403, "demo_readonly", "Demo mode messaging is disabled.");

  const { supabase, user } = await requireUser();
  const { body, client_action_id } = await readJson(request, messageSchema);

  // Fetch thread to validate participant and determine recipient
  const { data: thread, error: threadErr } = await supabase.from("threads").select("id, buyer_id, seller_id").eq("id", threadId).single();
  if (threadErr) {
    if ((threadErr as { code?: string }).code === "PGRST116" || threadErr.message?.includes("No rows")) throw new ApiProblem(404, "not_found", "Thread not found.");
    console.error("[messages POST] thread fetch error:", threadErr);
    throw new ApiProblem(500, "db_error", "Failed to load thread.");
  }
  const t = thread as { id: string; buyer_id: string; seller_id: string };
  if (t.buyer_id !== user.id && t.seller_id !== user.id) {
    throw new ApiProblem(403, "forbidden", "You are not a participant of this thread.");
  }

  const recipient_id = t.buyer_id === user.id ? t.seller_id : t.buyer_id;
  const sender_id = user.id;

  // Validate sender+recipient against immutable thread: ensure we derive recipient from thread, not client input
  // Already done

  const { data: replay, error: replayErr } = await supabase
    .from("messages")
    .select("id, thread_id, sender_id, recipient_id, body, created_at, read_at, client_action_id")
    .eq("sender_id", sender_id)
    .eq("client_action_id", client_action_id)
    .maybeSingle();
  if (replayErr) throw new ApiProblem(500, "db_error", "Failed to verify message delivery.");
  if (replay) {
    const previous = replay as { thread_id: string; body: string };
    if (previous.thread_id !== threadId || previous.body !== body) throw new ApiProblem(409, "idempotency_mismatch", "This send action was already used for a different message.");
    return json(replay, 200);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("messages")
    .insert({
      thread_id: threadId,
      sender_id,
      recipient_id,
      body,
      client_action_id,
    })
    .select("id, thread_id, sender_id, recipient_id, body, created_at, read_at, client_action_id")
    .single();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      const { data: raced } = await supabase.from("messages").select("id, thread_id, sender_id, recipient_id, body, created_at, read_at, client_action_id").eq("sender_id", sender_id).eq("client_action_id", client_action_id).maybeSingle();
      if (raced && (raced as { thread_id: string; body: string }).thread_id === threadId && (raced as { body: string }).body === body) return json(raced, 200);
      throw new ApiProblem(409, "idempotency_mismatch", "This send action was already used for a different message.");
    }
    console.error("[messages POST] insert error:", insertErr);
    throw new ApiProblem(500, "db_error", "Failed to send message.");
  }

  // The messages_bump_thread trigger updates inbox ordering atomically with
  // this insert. A second request adds latency and requires unnecessary grants.

  return json(inserted, 201);
});
