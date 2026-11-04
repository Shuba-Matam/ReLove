import { describe, expect, it, vi } from "vitest";
import { removeUnreferencedImages } from "@/lib/server/storage";

describe("shared listing image cleanup", () => {
  it("does not remove an original still referenced by another listing", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const shared = `${userId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const remove = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: () => ({
        select: () => ({
          or: () => ({ limit: async () => ({ data: [{ id: "remaining-listing" }], error: null }) }),
        }),
      }),
      storage: { from: () => ({ remove }) },
    };
    expect(await removeUnreferencedImages(supabase as never, userId, [shared])).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
