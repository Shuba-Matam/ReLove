import { removeUnreferencedImages } from "@/lib/server/storage";
import { getListing } from "@/lib/server/queries";
import "server-only";
import { NextRequest } from "next/server";
import { derivePublicUrlFromClient } from "@/lib/server/supabase";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { listingUpdateSchema } from "@/lib/validation";
import { z } from "zod";
import type { Listing } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

function mapListingRow(row: Record<string, unknown>): Listing {
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

export const GET = withApi(async (_request: NextRequest, context: unknown) => {
 const { id } = await (context as { params: Promise<{ id: string }> }).params;
 const result = await getListing(id);
 return json(result.data, { mode: result.mode });
});

export const PATCH = withApi(async (request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ id: string }> } | { params: { id: string } };
  const rawParams = (ctx?.params as { id: string } | Promise<{ id: string }>) ?? { id: "" };
  const params = rawParams instanceof Promise ? await rawParams : rawParams;
  const id = params.id;

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) throw new ApiProblem(400, "validation_error", "Invalid listing id.");

  const mode = getAppMode();
  if (mode === "demo") throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only.");

  const { supabase, user } = await requireUser();

  const body = await readJson(request, listingUpdateSchema);

  // If image_path provided, validate ownership and derive image_url
  let image_url: string | undefined;
  if (body.image_path) {
    if (!body.image_path.startsWith(`${user.id}/`)) {
      throw new ApiProblem(400, "validation_error", "Invalid image_path ownership.", { image_path: ["Image must be in your folder."] });
    }
    image_url = derivePublicUrlFromClient(supabase, body.image_path);
    // Verify file exists — fail closed on list error and exact filename match
    const fileNamePatch = body.image_path.split("/")[1];
    const { data: files, error: listErr } = await supabase.storage.from("listing-images").list(user.id, { search: fileNamePatch });
    if (listErr) {
      console.error("[listings PATCH] storage list error:", listErr);
      throw new ApiProblem(500, "storage_error", "Failed to verify image. Please try again.");
    }
    const exactPatch = (files ?? []).some((f) => f.name === fileNamePatch);
    if (!exactPatch) {
      throw new ApiProblem(400, "validation_error", "Image not found.", { image_path: ["Referenced image does not exist."] });
    }
  }

  // Fetch existing to ensure owner and to handle orphan logic
  const { data: existing, error: fetchErr } = await supabase
    .from("listings")
    .select("id, seller_id, image_path, cutout_path")
    .eq("id", id)
    .single();

  if (fetchErr) {
    if ((fetchErr as { code?: string }).code === "PGRST116" || fetchErr.message?.includes("No rows")) {
      throw new ApiProblem(404, "not_found", "Listing not found.");
    }
    console.error("[listings PATCH] fetch error:", fetchErr);
    throw new ApiProblem(500, "db_error", "Failed to load listing.");
  }

  if (!existing || (existing as { seller_id: string }).seller_id !== user.id) {
    throw new ApiProblem(403, "forbidden", "You do not own this listing.");
  }

  const existingRow = existing as { id: string; seller_id: string; image_path: string; cutout_path: string | null };

  // If category_id provided, verify exists
  if (body.category_id) {
    const { data: cat, error: categoryError } = await supabase.from("categories").select("id").eq("id", body.category_id).maybeSingle();
    if (categoryError) throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "Categories are temporarily unavailable. Please try again.");
    if (!cat) throw new ApiProblem(400, "validation_error", "Invalid category.", { category_id: ["Category does not exist."] });
  }

  // Build update payload - only allow fields defined in schema, seller_id immutable
  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.price_inr !== undefined) update.price_inr = body.price_inr;
  if (body.category_id !== undefined) update.category_id = body.category_id;
  if (body.condition !== undefined) update.condition = body.condition;
  if (body.hostel_block !== undefined) update.hostel_block = body.hostel_block;
  if (body.image_path !== undefined) {
    update.image_path = body.image_path;
    if (image_url) update.image_url = image_url;
  }
  if (body.tags !== undefined) update.tags = body.tags;
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "sold") {
      throw new ApiProblem(400, "validation_error", "Invalid status.", { status: ["Status must be active or sold."] });
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    throw new ApiProblem(400, "validation_error", "No valid fields to update.");
  }

  // Never allow seller_id change
  // Perform update
  const { data, error } = await supabase
    .from("listings")
    .update(update)
    .eq("id", id)
    .eq("seller_id", user.id)
    .select("*, category:categories(id, slug, name, icon), seller:profiles!listings_seller_id_fkey(id, display_name, avatar_url, hostel_block, created_at)")
    .single();

  if (error) {
    console.error("[listings PATCH] db error:", error);
    throw new ApiProblem(500, "db_error", "Failed to update listing.");
  }

  if(body.image_path && body.image_path !== existingRow.image_path) await removeUnreferencedImages(supabase,user.id,[existingRow.image_path,existingRow.cutout_path]);

  const listing = mapListingRow(data as unknown as Record<string, unknown>);
  return json(listing);
});

export const DELETE = withApi(async (_request: NextRequest, context: unknown) => {
  const ctx = context as { params: Promise<{ id: string }> } | { params: { id: string } };
  const rawParams = (ctx?.params as { id: string } | Promise<{ id: string }>) ?? { id: "" };
  const params = rawParams instanceof Promise ? await rawParams : rawParams;
  const id = params.id;

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) throw new ApiProblem(400, "validation_error", "Invalid listing id.");

  const mode = getAppMode();
  if (mode === "demo") throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only.");

  const { supabase, user } = await requireUser();

  const { data: existing, error: fetchErr } = await supabase
    .from("listings")
    .select("id, seller_id, image_path, cutout_path")
    .eq("id", id)
    .single();

  if (fetchErr) {
    if ((fetchErr as { code?: string }).code === "PGRST116" || fetchErr.message?.includes("No rows")) {
      throw new ApiProblem(404, "not_found", "Listing not found.");
    }
    console.error("[listings DELETE] fetch error:", fetchErr);
    throw new ApiProblem(500, "db_error", "Failed to load listing.");
  }

  if (!existing || (existing as { seller_id: string }).seller_id !== user.id) {
    throw new ApiProblem(403, "forbidden", "You do not own this listing.");
  }

  const existingRow = existing as { id: string; seller_id: string; image_path: string; cutout_path: string | null };

  const { error: delErr } = await supabase.from("listings").delete().eq("id", id).eq("seller_id", user.id);

  if (delErr) {
    console.error("[listings DELETE] db error:", delErr);
    throw new ApiProblem(500, "db_error", "Failed to delete listing.");
  }

  const cleaned = await removeUnreferencedImages(supabase,user.id,[existingRow.image_path,existingRow.cutout_path]);

  return json({ deleted: true, cleanup_pending: !cleaned });
});
