import "server-only";
import { NextRequest } from "next/server";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { z } from "zod";
import type { Listing } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["active", "sold", "hidden"]).optional(),
});

function mapListingRow(row: Record<string, unknown>): Listing {
  const category = (row.category as Record<string, unknown> | null) ?? null;
  const seller = (row.seller as Record<string, unknown> | null) ?? null;
  return {
    id: row.id as string,
    seller_id: row.seller_id as string,
    category_id: row.category_id as string,
    title: row.title as string,
    description: row.description as string,
    price_inr: row.price_inr as number,
    condition: row.condition as Listing["condition"],
    hostel_block: row.hostel_block as string,
    status: row.status as Listing["status"],
    image_url: row.image_url as string,
    image_path: row.image_path as string,
    cutout_url: (row.cutout_url as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    ai_status: (row.ai_status as Listing["ai_status"]) ?? "none",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    category: category
      ? { id: category.id as string, slug: category.slug as string, name: category.name as string, icon: category.icon as string }
      : undefined,
    seller: seller
      ? { id: seller.id as string, display_name: seller.display_name as string, avatar_url: (seller.avatar_url as string | null) ?? null, hostel_block: (seller.hostel_block as string | null) ?? null, created_at: seller.created_at as string | undefined }
      : undefined,
  };
}

export const GET = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ status: url.searchParams.get("status") ?? undefined });
  if (!parsed.success) {
    throw new ApiProblem(400, "validation_error", "Invalid status filter.");
  }
  const status = parsed.data.status;

  if(mode === "demo") throw new ApiProblem(401,"unauthorized","Sign in to see your listings.");

  const { supabase, user } = await requireUser();

  let query = supabase
    .from("listings")
    .select("*, category:categories(id, slug, name, icon), seller:profiles!listings_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)")
    .eq("seller_id", user.id)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[my-listings] db error:", error);
    throw new ApiProblem(500, "db_error", "Failed to load your listings.");
  }

  const listings = (data ?? []).map((r) => mapListingRow(r as unknown as Record<string, unknown>));
  return json(listings);
});
