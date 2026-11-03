import "server-only";
import { DEMO_LISTINGS } from "@/lib/demo";
import { CATEGORIES, type ApiResponse, type Category, type Listing } from "@/lib/marketplace";
import { listingFiltersSchema, uuidSchema } from "@/lib/validation";
import { getAppMode } from "./env";
import { ApiProblem } from "./http";
import { createSupabaseServerClient } from "./supabase";

export const LISTING_SELECT = "*, category:categories(id, slug, name, icon), seller:profiles!listings_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)";

function normalizeListing(listing: Listing): Listing {
  return { ...listing, photo_display_mode: listing.photo_display_mode ?? (listing.cutout_url ? "both" : "original") };
}

export async function listListings(raw: Record<string, unknown>): Promise<ApiResponse<Listing[]>> {
  const filters = listingFiltersSchema.parse(raw);
  const mode = getAppMode();
  if (mode === "setup") throw new ApiProblem(503, "SETUP_REQUIRED", "The marketplace is being connected. Please come back soon.");
  if (mode === "demo") {
    let listings = DEMO_LISTINGS.filter((listing) => listing.status === "active");
    if (filters.q) { const terms = filters.q.toLocaleLowerCase().split(/\s+/).filter(Boolean); listings = listings.filter((listing) => { const text = `${listing.title} ${listing.description} ${listing.tags.join(" ")}`.toLowerCase(); return terms.every((term) => text.includes(term)); }); }
    if (filters.category) listings = listings.filter((listing) => listing.category?.slug === filters.category);
    if (filters.condition) listings = listings.filter((listing) => listing.condition === filters.condition);
    if (filters.hostel_block) listings = listings.filter((listing) => listing.hostel_block.toLowerCase() === filters.hostel_block!.toLowerCase());
    if (filters.min_price !== undefined) listings = listings.filter((listing) => listing.price_inr >= filters.min_price!);
    if (filters.max_price !== undefined) listings = listings.filter((listing) => listing.price_inr <= filters.max_price!);
    listings.sort((a, b) => filters.sort === "price_asc" ? a.price_inr - b.price_inr || a.id.localeCompare(b.id) : filters.sort === "price_desc" ? b.price_inr - a.price_inr || a.id.localeCompare(b.id) : b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    const end = filters.cursor + filters.limit;
    return { data: listings.slice(filters.cursor, end), mode, meta: { total: listings.length, next_cursor: end < listings.length ? end : null } };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new ApiProblem(503, "SETUP_REQUIRED", "The marketplace is being connected. Please come back soon.");
  let query = supabase.from("listings").select(LISTING_SELECT, { count: "exact" }).eq("status", "active");
  if (filters.q) query = query.textSearch("search", filters.q, { config: "english", type: "websearch" });
  if (filters.category) {
    const { data: category, error } = await supabase.from("categories").select("id").eq("slug", filters.category).maybeSingle();
    if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Listings are temporarily unavailable. Please try again.");
    if (!category) return { data: [], mode, meta: { total: 0, next_cursor: null } };
    query = query.eq("category_id", category.id);
  }
  if (filters.condition) query = query.eq("condition", filters.condition);
  if (filters.hostel_block) query = query.eq("hostel_block", filters.hostel_block);
  if (filters.min_price !== undefined) query = query.gte("price_inr", filters.min_price);
  if (filters.max_price !== undefined) query = query.lte("price_inr", filters.max_price);
  query = filters.sort === "newest" ? query.order("created_at", { ascending: false }) : query.order("price_inr", { ascending: filters.sort === "price_asc" });
  const { data, error, count } = await query.order("id", { ascending: true }).range(filters.cursor, filters.cursor + filters.limit - 1);
  if (error) {
    // PostgREST omits count on failed responses. Only recover an actual range
    // error, and read the same filtered query's count before reporting an empty page.
    if (error.code === "PGRST103") {
      const firstPage = await query.range(0, 0);
      const total = firstPage.count;
      if (!firstPage.error && total !== null && Number.isInteger(total) && total >= 0 && filters.cursor >= total) {
        return { data: [], mode, meta: { total, next_cursor: null } };
      }
    }
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Listings are temporarily unavailable. Please try again.");
  }
  const listings = ((data ?? []) as unknown as Listing[]).map(normalizeListing);
  const next = filters.cursor + listings.length;
  return { data: listings, mode, meta: { total: count ?? 0, next_cursor: next < (count ?? 0) ? next : null } };
}

export async function getListing(id: string): Promise<ApiResponse<Listing>> {
  if (!uuidSchema.safeParse(id).success) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
  const mode = getAppMode();
  if (mode === "demo") {
    const listing = DEMO_LISTINGS.find((item) => item.id === id && item.status !== "hidden");
    if (!listing) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
    return { data: listing, mode };
  }
  const supabase = mode === "live" ? await createSupabaseServerClient() : null;
  if (!supabase) throw new ApiProblem(503, "SETUP_REQUIRED", "The marketplace is being connected. Please come back soon.");
  const { data, error } = await supabase.from("listings").select(LISTING_SELECT).eq("id", id).maybeSingle();
  if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "This listing is temporarily unavailable. Please try again.");
  if (!data) throw new ApiProblem(404, "NOT_FOUND", "Listing not found.");
  return { data: normalizeListing(data as unknown as Listing), mode };
}

export async function getCategories(): Promise<ApiResponse<Category[]>> {
  const mode = getAppMode();
  if (mode === "demo") return { data: CATEGORIES, mode };
  const supabase = mode === "live" ? await createSupabaseServerClient() : null;
  if (!supabase) throw new ApiProblem(503, "SETUP_REQUIRED", "The marketplace is being connected. Please come back soon.");
  const { data, error } = await supabase.from("categories").select("id, slug, name, icon").order("name");
  if (error) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Categories are temporarily unavailable. Please try again.");
  return { data: data ?? [], mode };
}
