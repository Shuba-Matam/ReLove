import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { readMessagesSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

export const POST = withApi(async (request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ id: string }> } | { params: { id: string } };
  const raw = (ctx?.params as Promise<{ id: string }> | { id: string }) ?? { id: "" };
  const params = raw instanceof Promise ? await raw : raw;
  const threadId = params.id;

  const parsed = uuidSchema.safeParse(threadId);
  if (!parsed.success) throw new ApiProblem(400, "validation_error", "Invalid thread id.");

  const mode = getAppMode();
  if (mode === "demo") throw new ApiProblem(403, "demo_readonly", "Demo mode messaging is disabled.");

  const { supabase, user } = await requireUser();
  const cursor = await readJson(request, readMessagesSchema);

  // Verify participant
  const { data: thread, error: threadErr } = await supabase.from("threads").select("buyer_id, seller_id").eq("id", threadId).single();
  if (threadErr) {
    if ((threadErr as { code?: string }).code === "PGRST116" || threadErr.message?.includes("No rows")) throw new ApiProblem(404, "not_found", "Thread not found.");
    console.error("[read POST] thread fetch error:", threadErr);
    throw new ApiProblem(500, "db_error", "Failed to load thread.");
  }
  const t = thread as { buyer_id: string; seller_id: string };
  if (t.buyer_id !== user.id && t.seller_id !== user.id) {
    throw new ApiProblem(403, "forbidden", "You are not a participant.");
  }

  // Mark received messages as read: only update read_at where recipient is current user and read_at is null
  // No arbitrary update other than own received read_at; RLS and our where clause enforce this
  const { error: updErr } = await supabase.rpc("mark_thread_read", { p_thread_id: threadId, p_through_created_at: cursor.through_created_at, p_through_id: cursor.through_id });

  if (updErr) {
    console.error("[read POST] update error:", updErr);
    throw new ApiProblem(500, "db_error", "Failed to mark messages as read.");
  }

  return json({ updated: true });
});
