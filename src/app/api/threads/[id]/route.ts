import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { z } from "zod";
import type { ThreadDetail, ThreadSummary, Message } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

function toProfile(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    display_name: row.display_name as string,
    avatar_url: (row.avatar_url as string | null) ?? null,
    hostel_block: (row.hostel_block as string | null) ?? null,
    created_at: row.created_at as string | undefined,
  };
}

export const GET = withApi(async (request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ id: string }> } | { params: { id: string } };
  const raw = (ctx?.params as Promise<{ id: string }> | { id: string }) ?? { id: "" };
  const params = raw instanceof Promise ? await raw : raw;
  const threadId = params.id;

  const parsed = uuidSchema.safeParse(threadId);
  if (!parsed.success) throw new ApiProblem(400, "validation_error", "Invalid thread id.");

  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode messaging is disabled.");
  }

  const { supabase, user } = await requireUser();

  const { data: threadRow, error: threadErr } = await supabase
    .from("threads")
    .select(
      `
      id, listing_id, buyer_id, seller_id, created_at, updated_at,
      listing:listings!threads_listing_id_fkey(id, title, image_url, price_inr, status),
      buyer:profiles!threads_buyer_id_fkey(id, display_name, avatar_url, hostel_block, created_at),
      seller:profiles!threads_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)
    `
    )
    .eq("id", threadId)
    .single();

  if (threadErr) {
    if ((threadErr as { code?: string }).code === "PGRST116" || threadErr.message?.includes("No rows")) {
      throw new ApiProblem(404, "not_found", "Thread not found.");
    }
    console.error("[threads/:id GET] db error:", threadErr);
    throw new ApiProblem(500, "db_error", "Failed to load thread.");
  }

  const t = threadRow as unknown as {
    id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    created_at: string;
    updated_at: string;
    listing: { id: string; title: string; image_url: string; price_inr: number; status: string } | null;
    buyer: Record<string, unknown> | null;
    seller: Record<string, unknown> | null;
  };

  // Participant check
  if (t.buyer_id !== user.id && t.seller_id !== user.id) {
    throw new ApiProblem(403, "forbidden", "You are not a participant of this thread.");
  }

  const isBuyer = t.buyer_id === user.id;
  const participantRow = isBuyer ? t.seller : t.buyer;
  const participant = participantRow ? toProfile(participantRow) : { id: isBuyer ? t.seller_id : t.buyer_id, display_name: "Unknown", avatar_url: null, hostel_block: null };

  const before = z.string().datetime().optional().parse(new URL(request.url).searchParams.get("before") ?? undefined);
  let messageQuery = supabase
    .from("messages")
    .select("id, thread_id, sender_id, recipient_id, body, created_at, read_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(101);
  if(before) messageQuery=messageQuery.lt("created_at",before);
  const {data:messagesRaw,error:msgErr}=await messageQuery;

  if (msgErr) {
    console.error("[threads/:id GET] messages error:", msgErr);
    throw new ApiProblem(500, "db_error", "Failed to load messages.");
  }

  const hasMore = (messagesRaw?.length ?? 0) > 100;
  const messages: Message[] = (messagesRaw ?? []).slice(0,100).reverse().map((m) => ({
    id: (m as Record<string, unknown>).id as string,
    thread_id: (m as Record<string, unknown>).thread_id as string,
    sender_id: (m as Record<string, unknown>).sender_id as string,
    recipient_id: (m as Record<string, unknown>).recipient_id as string,
    body: (m as Record<string, unknown>).body as string,
    created_at: (m as Record<string, unknown>).created_at as string,
    read_at: (m as Record<string, unknown>).read_at as string | null,
  }));

  // Compute last_message and unread_count for summary
  const last = messages.length > 0 ? messages[messages.length - 1] : null;
  const unread = messages.filter((m) => m.recipient_id === user.id && m.read_at === null).length;

  const visibleListing = t.listing ?? { id:t.listing_id,title:"Listing unavailable",image_url:"/icons/icon.svg",price_inr:0,status:"hidden" };
  const summary: ThreadSummary = {
    id: t.id,
    listing: {
      id: visibleListing.id,
      title: visibleListing.title,
      image_url: visibleListing.image_url,
      price_inr: visibleListing.price_inr,
      status: visibleListing.status as ThreadSummary["listing"]["status"],
    },
    participant,
    last_message: last ? { body: last.body, created_at: last.created_at, sender_id: last.sender_id } : null,
    unread_count: unread,
    updated_at: t.updated_at,
  };

  const detail: ThreadDetail = { thread: summary, messages, has_more: hasMore, before: messages[0]?.created_at ?? null };

  return json(detail);
});
