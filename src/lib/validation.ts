import { z } from "zod";
import { CONDITIONS } from "./marketplace";

export const uuidSchema = z.string().uuid();
export const imagePathSchema = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i, "Use an uploaded listing image.");
export const photoDisplayModeSchema = z.enum(["original", "cutout", "both"] as const);
export const cutoutSelectionSchema = z.object({
  operation_id: uuidSchema,
  cutout_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i, "Use a generated cutout."),
}).strict();
export const listingSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(3000),
  price_inr: z.number().int().min(0).max(10000000),
  category_id: uuidSchema,
  condition: z.enum(CONDITIONS),
  hostel_block: z.string().trim().min(1).max(60),
  image_path: imagePathSchema,
  photo_display_mode: photoDisplayModeSchema.default("original"),
  cutout: cutoutSelectionSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  seller_confirmed: z.literal(true, { error: "Confirm the details before publishing." }),
}).strict();
export const listingUpdateSchema = listingSchema.omit({ seller_confirmed: true, photo_display_mode: true }).partial().extend({
  photo_display_mode: photoDisplayModeSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  status: z.enum(["active", "sold"] as const).optional(),
  seller_confirmed: z.literal(true).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "Provide a change.").refine((v) => Object.keys(v).every((key) => key === "status") || v.seller_confirmed === true, "Confirm the edited details before saving.");
export const listingFiltersSchema = z.object({
  q: z.string().trim().max(160).optional(),
  category: z.string().trim().max(50).optional(),
  condition: z.enum(CONDITIONS).optional(),
  hostel_block: z.string().trim().max(60).optional(),
  min_price: z.coerce.number().int().min(0).max(10000000).optional(),
  max_price: z.coerce.number().int().min(0).max(10000000).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  cursor: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(48).default(12),
}).refine((v) => v.min_price === undefined || v.max_price === undefined || v.min_price <= v.max_price, { message: "Minimum price must not exceed maximum price.", path: ["min_price"] });
export const profileSchema = z.object({ display_name: z.string().trim().min(2).max(60), hostel_block: z.string().trim().max(60).nullable() }).strict();
export const messageSchema = z.object({ body: z.string().trim().min(1).max(2000), client_action_id: uuidSchema.optional() }).strict();
export const readMessagesSchema = z.object({ through_created_at: z.string().datetime(), through_id: uuidSchema }).strict();
export const startThreadSchema = z.object({ listing_id: uuidSchema }).strict();
export const reportSchema = z.object({ listing_id: uuidSchema, reason: z.enum(["prohibited", "misleading", "spam", "other"]), details: z.string().trim().max(1000).default("") }).strict();
export type ListingInput = z.infer<typeof listingSchema>;
export type ListingFilters = z.infer<typeof listingFiltersSchema>;
