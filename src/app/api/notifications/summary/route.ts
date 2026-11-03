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
    throw new ApiProblem(500, "db_error", "Failed to load notifications.");
  }

  const unreadCount = count ?? 0;

  if (unreadCount === 0) {
    return json({ unreadCount: 0, messages: [] });
  }

  const { data: msgRows, error: msgErr } = await supabase
    .from("messages")
    .select("id, thread_id, created_at")
    .eq("recipient_id", user.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (msgErr) {
    console.error("[notifications/summary] messages error:", msgErr);
    throw new ApiProblem(500, "db_error", "Failed to load notifications.");
  }

  if (!msgRows || msgRows.length === 0) {
    return json({ unreadCount, messages: [] });
  }

  // Validate rows shape (defensive, but db is trusted)
  const parsedMsgs = z.array(messageRowSchema).safeParse(msgRows);
  if (!parsedMsgs.success) {
    console.error("[notifications/summary] message parse error:", parsedMsgs.error);
    throw new ApiProblem(500, "db_error", "Failed to load notifications.");
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
    throw new ApiProblem(500, "db_error", "Failed to load notifications.");
  }

  const parsedThreads = z.array(threadRowSchema).safeParse(threadRows ?? []);
  // If parse fails, fall back to minimal mapping without throwing (privacy safe)
  const threadMap = new Map<string, z.infer<typeof threadRowSchema>>();
  if (parsedThreads.success) {
    for (const t of parsedThreads.data) threadMap.set(t.id, t);
  } else {
    // Best effort: use raw data as is if schema mismatch, but log
    console.error("[notifications/summary] thread parse error:", parsedThreads.error);
    for (const t of (threadRows as unknown as z.infer<typeof threadRowSchema>[]) ?? []) {
      if (t?.id) threadMap.set(t.id, t);
    }
  }

  const messages = parsedMsgs.data
    .map((m) => {
      const t = threadMap.get(m.thread_id);
      if (!t) return null;
      const isBuyer = t.buyer_id === user.id;
      const participantName = isBuyer ? (t.seller?.display_name ?? "Unknown") : (t.buyer?.display_name ?? "Unknown");
      const listingTitle = t.listing?.title ?? "Listing";
      const listingImageUrl = t.listing?.image_url ?? "/icons/icon.svg";
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

  // Do not return bodies; response is Zod-validated on client as well
  return json({ unreadCount, messages });
});
