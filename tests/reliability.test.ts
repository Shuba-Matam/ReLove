import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/auth";
import { listListings } from "@/lib/server/queries";
import { GET as feed, POST as createListing } from "@/app/api/listings/route";
import { PATCH as editListing } from "@/app/api/listings/[id]/route";
import { POST as sendMessage } from "@/app/api/threads/[id]/messages/route";

vi.mock("@/lib/server/supabase", async (original) => ({
  ...await original<typeof import("@/lib/server/supabase")>(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ requireUser: vi.fn() }));

const owner = "11111111-1111-4111-8111-111111111111";
const buyer = "22222222-2222-4222-8222-222222222222";
const listingId = "33333333-3333-4333-8333-333333333333";
const category = "00000000-0000-4000-8000-000000000003";
const imagePath = `${owner}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
type Reply = { body: unknown; status?: number; range?: string };

// Exercise the installed SDK's response handling, including its null count on
// errors, without a database account or any external requests.
function database(...replies: Reply[]) {
  const fetcher = vi.fn(async () => {
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected database request");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...(reply.range ? { "content-range": reply.range } : {}) },
    });
  });
  const client = createClient("https://database.example.test", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetcher },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
  vi.mocked(requireUser).mockResolvedValue({ supabase: client, user: { id: owner } });
  return fetcher;
}

function mutation(path: string, method: string, body: unknown) {
  return new NextRequest(`https://relove.test${path}`, {
    method,
    headers: { origin: "https://relove.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.stubEnv("APP_MODE", "live"));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("live marketplace failure and pagination boundaries", () => {
  it.each(["PGRST205", "42P01", "42501", "57014", ""])("reports %s as unavailable, never empty inventory", async (code) => {
    const fetcher = database({ status: 400, body: { code, message: "private database detail" } });
    const response = await feed(new NextRequest("https://relove.test/api/listings?cursor=36"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: { code: "DATABASE_UNAVAILABLE", message: "Listings are temporarily unavailable. Please try again." } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([0, 5])("accepts a successful empty result with total %i", async (total) => {
    database({ body: [], range: `*/${total}` });
    expect(await listListings({ cursor: 12 })).toEqual({ data: [], mode: "live", meta: { total, next_cursor: null } });
  });

  it("returns a cursor for the next populated page", async () => {
    const rows = [{ id: listingId }, { id: buyer }];
    database({ body: rows, range: "0-1/3" });
    expect(await listListings({ limit: 2 })).toEqual({ data: rows, mode: "live", meta: { total: 3, next_cursor: 2 } });
  });

  it.each([0, 24])("recovers a range error with a verified total %i and preserves filters", async (total) => {
    const fetcher = database(
      { status: 416, body: { code: "PGRST103", message: "Requested range not satisfiable" }, range: `*/${total}` },
      { body: total ? [{ id: listingId }] : [], range: total ? `0-0/${total}` : "*/0" },
    );
    expect(await listListings({ cursor: 24, q: "chair", condition: "good", min_price: 10, sort: "price_asc" }))
      .toEqual({ data: [], mode: "live", meta: { total, next_cursor: null } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const urls = fetcher.mock.calls.map((call) => new URL(String((call as unknown[])[0])));
    for (const url of urls) {
      expect(url.searchParams.get("search")).toBe("wfts(english).chair");
      expect(url.searchParams.get("status")).toBe("eq.active");
      expect(url.searchParams.get("condition")).toBe("eq.good");
      expect(url.searchParams.get("price_inr")).toBe("gte.10");
      expect(url.searchParams.get("order")).toBe("price_inr.asc,id.asc");
    }
    expect(urls[0].searchParams.get("offset")).toBe("24");
    expect(urls[1].searchParams.get("offset")).toBe("0");
    expect(urls[1].searchParams.get("limit")).toBe("1");
  });

  it.each<Reply>([
    { status: 400, body: { code: "42501", message: "denied" } },
    { body: [] },
    { body: [], range: "*/NaN" },
    { body: [{ id: listingId }], range: "0-0/30" },
  ])("does not invent a total if range recovery is inconclusive: %j", async (reply) => {
    const fetcher = database({ status: 416, body: { code: "PGRST103" } }, reply);
    await expect(listListings({ cursor: 24 })).rejects.toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("listing validation distinguishes missing categories from outages", () => {
  const input = { title: "Desk chair", description: "A comfortable desk chair.", category_id: category, condition: "good", price_inr: 100, hostel_block: "A", image_path: imagePath, seller_confirmed: true };

  it.each(["POST", "PATCH"])("%s returns retryable category failure without saving", async (method) => {
    const prerequisite = method === "POST" ? [{ name: imagePath.split("/")[1] }] : { id: listingId, seller_id: owner, image_path: imagePath, cutout_path: null };
    const fetcher = database({ body: prerequisite }, { status: 400, body: { code: "42501", message: "denied" } });
    const response = method === "POST"
      ? await createListing(mutation("/api/listings", method, input))
      : await editListing(mutation(`/api/listings/${listingId}`, method, { category_id: category, seller_confirmed: true }), { params: Promise.resolve({ id: listingId }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("DATABASE_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("still rejects a genuinely missing category", async () => {
    database({ body: [{ name: imagePath.split("/")[1] }] }, { body: [] });
    const response = await createListing(mutation("/api/listings", "POST", input));
    expect(response.status).toBe(400);
    expect((await response.json()).error.fields.category_id).toEqual(["Category does not exist."]);
  });
});

it("sends a message without a second, redundant thread update", async () => {
  const saved = { id: listingId, thread_id: listingId, sender_id: owner, recipient_id: buyer, body: "Available?", created_at: "2026-11-02T00:00:00Z", read_at: null };
  const fetcher = database({ body: { id: listingId, buyer_id: buyer, seller_id: owner } }, { body: saved });
  const response = await sendMessage(mutation(`/api/threads/${listingId}/messages`, "POST", { body: "Available?" }), { params: Promise.resolve({ id: listingId }) });
  expect(response.status).toBe(201);
  expect((await response.json()).data).toEqual(saved);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
