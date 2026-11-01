import "server-only";
import type { createSupabaseServerClient } from "./supabase";
import { imagePathSchema } from "@/lib/validation";

type Client = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
export async function removeUnreferencedImages(supabase: Client, userId: string, paths: (string | null | undefined)[]): Promise<boolean> {
  let allRemoved = true;
  for (const path of new Set(paths.filter((value): value is string => Boolean(value)))) {
    if (!imagePathSchema.safeParse(path).success || !path.startsWith(`${userId}/`)) { allRemoved = false; continue; }
    const { data: references, error } = await supabase.from("listings").select("id").or(`image_path.eq.${path},cutout_path.eq.${path}`).limit(1);
    if (error) { allRemoved = false; continue; }
    if (references?.length) continue;
    const { error: storageError } = await supabase.storage.from("listing-images").remove([path]);
    if (storageError) { allRemoved = false; console.warn("Listing image cleanup pending"); }
  }
  return allRemoved;
}
