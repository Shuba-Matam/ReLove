import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { startThreadSchema } from "@/lib/validation";
import type { ThreadSummary, Profile } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

type ThreadRow = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  created_at: string;
  updated_at: string;
  listing: { id: string; title: string; image_url: string; price_inr: number; status: string } | null;
  buyer: Profile | null;
  seller: Profile | null;
};

function toThreadSummary(row: ThreadRow, currentUserId: string, lastMessage: { body: string; created_at: string; sender_id: string } | null, unreadCount: number): ThreadSummary {
  const isBuyer = row.buyer_id === currentUserId;
  const other = isBuyer ? row.seller : row.buyer;
  const listing = row.listing ?? { id: row.listing_id, title:"Listing unavailable",image_url:"/icons/icon-192.png",price_inr:0,status:"hidden" };
  return {
    id: row.id,
    listing: {
      id: listing.id,
      title: listing.title,
      image_url: listing.image_url,
      price_inr: listing.price_inr,
      status: listing.status as ThreadSummary["listing"]["status"],
    },
    participant: other ?? { id: isBuyer ? row.seller_id : row.buyer_id, display_name: "Unknown", avatar_url: null, hostel_block: null },
    last_message: lastMessage,
    unread_count: unreadCount,
    updated_at: row.updated_at,
  };
}

export const GET = withApi(async () => {
  const mode = getAppMode();
  if (mode === "demo") {
    // Demo is readonly; return empty inbox explicitly labelled demo
    return json([] as ThreadSummary[]);
  }

  const { supabase, user } = await requireUser();

  const { data: threads, error } = await supabase
    .from("threads")
    .select(
      `
      id, listing_id, buyer_id, seller_id, created_at, updated_at,
      listing:listings!threads_listing_id_fkey(id, title, image_url, price_inr, status),
      buyer:profiles!threads_buyer_id_fkey(id, display_name, avatar_url, hostel_block, created_at),
      seller:profiles!threads_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)
    `
    )
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("updated_at", { ascending: false }).limit(100);

  if (error) {
    console.error("[threads GET] db error:", error);
    throw new ApiProblem(500, "db_error", "Failed to load threads.");
  }

  if (!threads || threads.length === 0) {
    return json([] as ThreadSummary[]);
  }

  // Fetch last_message and unread_count per thread in parallel
  const summaries = await Promise.all(
    (threads as unknown as ThreadRow[]).map(async (t) => {
      const [lastMsgRes, unreadRes] = await Promise.all([
        supabase
          .from("messages")
          .select("body, created_at, sender_id")
          .eq("thread_id", t.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("thread_id", t.id)
          .eq("recipient_id", user.id)
          .is("read_at", null),
      ]);

      if(lastMsgRes.error || unreadRes.error) throw new ApiProblem(503,"MESSAGES_UNAVAILABLE","Messages are temporarily unavailable.");
      const lastMessage = lastMsgRes.data
        ? { body: (lastMsgRes.data as { body: string }).body, created_at: (lastMsgRes.data as { created_at: string }).created_at, sender_id: (lastMsgRes.data as { sender_id: string }).sender_id }
        : null;
      const unread = (unreadRes.count as number) ?? 0;

      return toThreadSummary(t, user.id, lastMessage, unread);
    })
  );

  return json(summaries);
});

export const POST = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only. Messaging is disabled.");
  }

  const { supabase, user } = await requireUser();
  const { listing_id } = await readJson(request, startThreadSchema);

  // Fetch listing to get seller
  const { data: listing, error: listingErr } = await supabase
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", listing_id)
    .single();

  if (listingErr) {
    if ((listingErr as { code?: string }).code === "PGRST116" || listingErr.message?.includes("No rows")) {
      throw new ApiProblem(404, "not_found", "Listing not found.");
    }
    console.error("[threads POST] listing fetch error:", listingErr);
    throw new ApiProblem(500, "db_error", "Failed to load listing.");
  }

  const lst = listing as { id: string; seller_id: string; status: string };
  if (lst.seller_id === user.id) {
    throw new ApiProblem(400, "validation_error", "You cannot message yourself about your own listing.");
  }

  // Check existing idempotent
  const { data: existing, error: existingErr } = await supabase
    .from("threads")
    .select("id")
    .eq("listing_id", listing_id)
    .eq("buyer_id", user.id)
    .maybeSingle();

  if (existingErr && (existingErr as { code?: string }).code !== "PGRST116") {
    console.error("[threads POST] existing check error:", existingErr);
    throw new ApiProblem(500, "db_error", "Failed to check existing thread.");
  }

  if (existing) {
    const row = existing as { id: string };
    return json({ id: row.id }, 200);
  }

  if(lst.status !== "active") throw new ApiProblem(409,"LISTING_UNAVAILABLE","This item is no longer available.");

  // Create new thread - race-safe via unique constraint (listing_id, buyer_id)
  const insertPayload = {
    listing_id,
    buyer_id: user.id,
    seller_id: lst.seller_id,
  };

  const { data: created, error: createErr } = await supabase
    .from("threads")
    .insert(insertPayload)
    .select("id")
    .single();

  if (createErr) {
    // Handle race: unique violation (23505) means another request created it concurrently
    if ((createErr as { code?: string }).code === "23505" || createErr.message?.includes("duplicate") || createErr.message?.includes("unique")) {
      const { data: raced, error: racedErr } = await supabase
        .from("threads")
        .select("id")
        .eq("listing_id", listing_id)
        .eq("buyer_id", user.id)
        .single();
      if (!racedErr && raced) {
        return json({ id: (raced as { id: string }).id }, 200);
      }
    }
    console.error("[threads POST] create error:", createErr);
    throw new ApiProblem(500, "db_error", "Failed to create thread.");
  }

  return json({ id: (created as { id: string }).id }, 201);
});
