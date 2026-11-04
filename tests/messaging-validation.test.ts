import { describe, expect, it } from "vitest";
import { messagingTimestampSchema } from "@/lib/messaging-validation";
import { notificationMessageSchema } from "@/lib/notifications";
import { readMessagesSchema } from "@/lib/validation";

const supabaseTimestamp = "2026-11-04T21:37:12.162349+00:00";
const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const threadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("messaging timestamp validation", () => {
  it("accepts Supabase offset timestamps without changing microsecond precision", () => {
    expect(messagingTimestampSchema.parse(supabaseTimestamp)).toBe(supabaseTimestamp);
    expect(readMessagesSchema.parse({
      through_created_at: supabaseTimestamp,
      through_id: messageId,
    }).through_created_at).toBe(supabaseTimestamp);
    expect(notificationMessageSchema.parse({
      id: messageId,
      threadId,
      createdAt: supabaseTimestamp,
      listingTitle: "Chair",
      listingImageUrl: "/icons/icon-192.png",
      participantName: "Bob",
    }).createdAt).toBe(supabaseTimestamp);
  });

  it.each([
    "not-a-timestamp",
    "2026-11-04",
    "2026-11-04T21:37:12.162349",
    "2026-11-04T21:37:12.162349+25:00",
  ])("rejects invalid timestamp %s", (timestamp) => {
    expect(messagingTimestampSchema.safeParse(timestamp).success).toBe(false);
  });
});
