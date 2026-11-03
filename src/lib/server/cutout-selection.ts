import "server-only";
import { z } from "zod";
import { ApiProblem } from "./http";
import { derivePublicUrlFromClient } from "./supabase";
import { cutoutSelectionSchema } from "@/lib/validation";

const completedCutoutResultSchema = z.object({
  cutout_path: z.string(),
  cutout_url: z.string(),
  source_image_path: z.string(),
  status: z.literal("done"),
}).passthrough();

type SupabaseLike = {
  from: (table: string) => unknown;
  storage: { from: (bucket: string) => { list: (path: string, options: { search: string }) => Promise<{ data: { name: string }[] | null; error: unknown }> } };
};

export async function validateCutoutSelection(
  supabase: SupabaseLike,
  userId: string,
  imagePath: string,
  rawSelection: unknown,
): Promise<{ cutout_path: string; cutout_url: string } | null> {
  if (rawSelection === null || rawSelection === undefined) return null;
  const selection = cutoutSelectionSchema.parse(rawSelection);
  if (!selection.cutout_path.startsWith(`${userId}/`)) throw new ApiProblem(403, "CUTOUT_OWNER", "Choose a cutout generated from your photo.");

  const query = supabase.from("ai_operations") as {
    select: (columns: string) => { eq: (column: string, value: string) => { eq: (column: string, value: string) => { eq: (column: string, value: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } } } } };
  };
  const { data, error } = await query.select("id,user_id,feature,status,result").eq("id", selection.operation_id).eq("user_id", userId).eq("feature", "cutout").eq("status", "done").maybeSingle();
  if (error || !data) throw new ApiProblem(400, "CUTOUT_INVALID", "That generated cutout could not be verified. Generate it again or use the original.");
  const operation = data as { feature?: string; status?: string; result?: unknown };
  if (operation.feature !== "cutout" || operation.status !== "done") throw new ApiProblem(400, "CUTOUT_INVALID", "That cutout is not complete.");
  const parsed = completedCutoutResultSchema.safeParse(operation.result);
  if (!parsed.success || parsed.data.source_image_path !== imagePath || parsed.data.cutout_path !== selection.cutout_path) {
    throw new ApiProblem(400, "CUTOUT_SOURCE", "That cutout belongs to a different photo. Generate a new cutout for this photo.");
  }
  const expectedUrl = derivePublicUrlFromClient(supabase as never, selection.cutout_path);
  if (parsed.data.cutout_url !== expectedUrl) throw new ApiProblem(400, "CUTOUT_INVALID", "That generated cutout could not be verified.");

  const fileName = selection.cutout_path.split("/")[1];
  const { data: files, error: listError } = await supabase.storage.from("listing-images").list(userId, { search: fileName });
  if (listError || !(files ?? []).some((file) => file.name === fileName)) throw new ApiProblem(400, "CUTOUT_MISSING", "The generated cutout is no longer available. Generate it again or use the original.");
  return { cutout_path: selection.cutout_path, cutout_url: expectedUrl };
}
