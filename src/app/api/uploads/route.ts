import "server-only";
import { NextRequest } from "next/server";
import { derivePublicUrlFromClient } from "@/lib/server/supabase";
import { getAppMode } from "@/lib/server/env";
import { json, ApiProblem, withApi, readFormLimited, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { z } from "zod";
import sharp from "sharp";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({ path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i, "Invalid path.") }).strict();

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export const POST = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only. Uploads are disabled.");
  }

  const { supabase, user } = await requireUser();

  let form: FormData;
  try {
    form = await readFormLimited(request,MAX_BYTES + 65536);
  } catch (error) {
    if(error instanceof ApiProblem) throw error;
    throw new ApiProblem(400, "invalid_request", "Expected multipart form with file.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ApiProblem(400, "validation_error", "Missing file.", { file: ["File is required."] });
  }

  if (file.size > MAX_BYTES) {
    throw new ApiProblem(400, "validation_error", "File too large. Max 2MB.", { file: ["File exceeds 2MB limit."] });
  }

  if (file.size === 0) {
    throw new ApiProblem(400, "validation_error", "Empty file.", { file: ["File is empty."] });
  }

  const mime = file.type?.toLowerCase() ?? "";
  if (mime && !ALLOWED_MIME.has(mime)) {
    throw new ApiProblem(400, "validation_error", "Unsupported image type.", { file: ["Use JPEG, PNG, or WEBP."] });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Validate bytes with sharp and sanitize reencode
  let sanitized: Buffer;
  let extension = "jpg";
  try {
    const image = sharp(buffer,{limitInputPixels:16000000,animated:false});
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Invalid image metadata");
    }
    if (!metadata.format || !["jpeg", "jpg", "png", "webp"].includes(metadata.format)) {
      throw new ApiProblem(400, "validation_error", "Unsupported image format.", { file: ["Use JPEG, PNG, or WEBP."] });
    }

    // Sanitize reencode: rotate to handle EXIF, re-encode to strip metadata
    // Preserve format but normalize to JPEG for consistency, or keep original if png/webp
    // Requirement: sanitize reencode if necessary, UUID names own user folder
    // We will re-encode to JPEG with quality 82 to ensure sanitization and size constraint
    // For PNG with transparency, we could keep PNG, but converting to JPEG is safer for storage
    // Choose: always reencode to JPEG (original compressed image always preserved as listing source)
    sanitized = await sharp(buffer,{limitInputPixels:16000000}).rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    extension = "jpg";
  } catch (err) {
    if (err instanceof ApiProblem) throw err;
    console.error("[upload] sharp validation failed:", err);
    throw new ApiProblem(400, "validation_error", "Invalid or corrupted image file.", { file: ["File is not a valid image."] });
  }

  if (sanitized.length > MAX_BYTES) {
    // If re-encoded still too large, try lower quality
    try {
      sanitized = await sharp(buffer).rotate().jpeg({ quality: 70, mozjpeg: true }).toBuffer();
      if (sanitized.length > MAX_BYTES) {
        throw new ApiProblem(400, "validation_error", "Image too large after processing. Please use a smaller image.", { file: ["Compressed image exceeds 2MB."] });
      }
    } catch (e) {
      if (e instanceof ApiProblem) throw e;
      throw new ApiProblem(400, "validation_error", "Image too large after processing.");
    }
  }

  const path = `${user.id}/${randomUUID()}.${extension}`;

  const { error: uploadErr } = await supabase.storage.from("listing-images").upload(path, sanitized, {
    contentType: "image/jpeg",
    upsert: false,
  });

  if (uploadErr) {
    console.error("[upload] storage error:", uploadErr);
    throw new ApiProblem(500, "storage_error", "Failed to upload image.");
  }

  const url = derivePublicUrlFromClient(supabase, path);

  return json({ path, url }, 201);
});

export const DELETE = withApi(async (request: NextRequest) => {
  const mode = getAppMode();
  if (mode === "demo") {
    throw new ApiProblem(403, "demo_readonly", "Demo mode is read-only.");
  }

  const { supabase, user } = await requireUser();

  const body = await readJson(request, deleteSchema);
  const path = body.path;

  // Ownership check: must be own folder
  if (!path.startsWith(`${user.id}/`)) {
    throw new ApiProblem(403, "forbidden", "You can only delete your own uploads.");
  }

  // Check if path is referenced by any listing (including own or others) - delete unreferenced only
  const { data: refs, error: refErr } = await supabase.from("listings").select("id").or(`image_path.eq.${path},cutout_path.eq.${path}`).limit(1);
  if (refErr) {
    console.error("[uploads DELETE] ref check error:", refErr);
    throw new ApiProblem(500, "db_error", "Failed to verify image reference.");
  }
  if (refs && refs.length > 0) {
    throw new ApiProblem(409, "still_referenced", "Cannot delete image still used by a listing.", { path: ["Image is referenced by a listing."] });
  }

  // Verify file exists before deleting? List to confirm
  const fileName = path.split("/")[1];
  const { data: files, error: listErr } = await supabase.storage.from("listing-images").list(user.id, { search: fileName });
  if (listErr) {
    console.error("[uploads DELETE] list error:", listErr);
    // Continue to attempt delete anyway
  } else if (!files || files.length === 0) {
    throw new ApiProblem(404, "not_found", "Image not found.");
  }

  const { error: delErr } = await supabase.storage.from("listing-images").remove([path]);
  if (delErr) {
    console.error("[uploads DELETE] storage error:", delErr);
    throw new ApiProblem(500, "storage_error", "Failed to delete image.");
  }

  return json({ deleted: true });
});
