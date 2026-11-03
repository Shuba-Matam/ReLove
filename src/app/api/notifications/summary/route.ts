import "server-only";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const messageRowSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  created_at: z.string(),
});

const threadRowSchema = z.object({
  id: z.string().uuid(),
  listing_id: z.string().uuid(),
  buyer_id: z.string().uuid(),
  seller_id: z.string().uuid(),
  listing: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      image_url: z.string(),
    })
    .nullable(),
  buyer: z
    .object({
      display_name: z.string(),
    })
    .nullable(),
  seller: z
    .object({
      display_name: z.string(),
    })
    .nullable(),
});

export const GET = withApi(async () => {
  const mode = getAppMode();
  if (mode === "demo" || mode === "setup") {
    return json({ unreadCount: 0, messages: [] });
  }

  const { supabase, user } = await requireUser();

  // Fixed 3 queries total, no per-thread N+1: count head + limited messages + batched thread metadata
  const { count, error: countErr } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (countErr) {
    console.error("[notifications/summary] count error:", countErr);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  // Null/non-integer count must not become 0 — treat as unavailable
  if (count === null || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    console.error("[notifications/summary] invalid count:", count);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  const unreadCount = count;

  if (unreadCount === 0) {
    return json({ unreadCount: 0, messages: [] });
  }

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, thread_id, created_at")
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);

  if (msgErr) {
    console.error("[notifications/summary] messages error:", msgErr);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  if (!msgRows || msgRows.length === 0) {
    return json({ unreadCount, messages: [] });
  }

  const parsedMsgs = z.array(messageRowSchema).safeParse(msgRows);
  if (!parsedMsgs.success) {
    console.error("[notifications/summary] message parse error:", parsedMsgs.error);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  const threadIds = Array.from(new Set(parsedMsgs.data.map((m) => m.thread_id)));

  const { data: threadRows, error: threadErr } = await supabase
    .from("threads")
    .select(
      `
      id, listing_id, buyer_id, seller_id,
      listing:listings!threads_listing_id_fkey(id, title, image_url),
      buyer:profiles!threads_buyer_id_fkey(display_name),
      seller:profiles!threads_seller_id_fkey(display_name)
    `
    )
    .in("id", threadIds);

  if (threadErr) {
    console.error("[notifications/summary] threads error:", threadErr);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  const parsedThreads = z.array(threadRowSchema).safeParse(threadRows ?? []);
  if (!parsedThreads.success) {
    console.error("[notifications/summary] thread parse error:", parsedThreads.error);
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Notifications are temporarily unavailable. Please try again.");
  }

  const threadMap = new Map<string, z.infer<typeof threadRowSchema>>();
  for (const t of parsedThreads.data) threadMap.set(t.id, t);

  const messages = parsedMsgs.data
    .map((m) => {
      const t = threadMap.get(m.thread_id);
      if (!t) return null;
      const isBuyer = t.buyer_id === user.id;
      const participantName = isBuyer ? (t.seller?.display_name ?? "Unknown") : (t.buyer?.display_name ?? "Unknown");
      const listingTitle = t.listing?.title ?? "Listing";
      const listingImageUrl = t.listing?.image_url ?? "/icons/icon-192.png";
      return {
        id: m.id,
        threadId: m.thread_id,
        createdAt: m.created_at,
        listingTitle,
        listingImageUrl,
        participantName,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return json({ unreadCount, messages });
});
