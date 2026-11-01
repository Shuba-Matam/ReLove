import { listListings } from "@/lib/server/queries";
import "server-only";
import { NextRequest } from "next/server";
import { derivePublicUrlFromClient } from "@/lib/server/supabase";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { listingSchema } from "@/lib/validation";
import type { Listing } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

function mapListingRow(row: Record<string, unknown>): Listing {
  // Supabase join may nest category and seller
  const category = (row.category as Record<string, unknown> | null) ?? null;
  const seller = (row.seller as Record<string, unknown> | null) ?? (row.profiles as Record<string, unknown> | null) ?? null;
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
      ? {
          id: category.id as string,
          slug: category.slug as string,
          name: category.name as string,
          icon: category.icon as string,
        }
      : undefined,
    seller: seller
      ? {
          id: seller.id as string,
          display_name: seller.display_name as string,
          avatar_url: (seller.avatar_url as string | null) ?? null,
          hostel_block: (seller.hostel_block as string | null) ?? null,
          created_at: seller.created_at as string | undefined,
        }
      : undefined,
  };
}

export const GET = withApi(async (request: NextRequest) => {
  const result = await listListings(Object.fromEntries(new URL(request.url).searchParams));
  return json(result.data, { mode: result.mode, meta: result.meta });
});

export const POST = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only. Creating listings is disabled.");
  }

  const { supabase, user } = await requireUser();

  const input = await readJson(request, listingSchema);

  // Derive image_url from image_path via storage public URL
  const image_url = derivePublicUrlFromClient(supabase, input.image_path);

  // Validate image_path ownership: must start with user.id
  if (!input.image_path.startsWith(`${user.id}/`)) {
    throw new ApiProblem(400, "validation_error", "Invalid image_path ownership.", { image_path: ["Image must be uploaded to your folder."] });
  }

  // Verify referenced upload exists in storage — fail closed on list error and exact filename match
  const fileName = input.image_path.split("/")[1];
  const { data: listedFiles, error: listErr } = await supabase.storage.from("listing-images").list(user.id, { search: fileName });
  if (listErr) {
    console.error("[listings POST] storage list error:", listErr);
    throw new ApiProblem(500, "storage_error", "Failed to verify image. Please try again.");
  }
  const exactMatch = (listedFiles ?? []).some((f) => f.name === fileName);
  if (!exactMatch) {
    throw new ApiProblem(400, "validation_error", "Image not found. Please upload again.", { image_path: ["Referenced image does not exist in storage."] });
  }

  // Ensure category exists
  const { data: catExists } = await supabase.from("categories").select("id").eq("id", input.category_id).single();
  if (!catExists) {
    throw new ApiProblem(400, "validation_error", "Invalid category.", { category_id: ["Category does not exist."] });
  }

  const insertPayload = {
    seller_id: user.id,
    category_id: input.category_id,
    title: input.title,
    description: input.description,
    price_inr: input.price_inr,
    condition: input.condition,
    hostel_block: input.hostel_block,
    image_path: input.image_path,
    image_url,
    tags: input.tags,
    status: "active" as const,
    ai_status: "none" as const,
  };

  const { data, error } = await supabase
    .from("listings")
    .insert(insertPayload)
    .select("*, category:categories(id, slug, name, icon), seller:profiles!listings_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)")
    .single();

  if (error) {
    console.error("[listings POST] db error:", error);
    // Handle image_path validation maybe trigger
    throw new ApiProblem(500, "db_error", "Failed to create listing.");
  }

  const listing = mapListingRow(data as unknown as Record<string, unknown>);
  return json(listing, 201);
});
