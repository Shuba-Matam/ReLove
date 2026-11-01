import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

export async function createSupabaseServerClient() {
  const { url, publishableKey, hasConfig } = getSupabaseEnv();
  if (!hasConfig) return null;

  const cookieStore = await cookies();

  const client = createServerClient(url, publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll may be called from Server Component where cookies is read-only; ignore.
        }
      },
    },
  });

  return client;
}

// Helper to derive public URL for listing-images path
export function getPublicImageUrl(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>, path: string): string;
export function getPublicImageUrl(supabase: unknown, path: string): string;
export function getPublicImageUrl(supabase: unknown, path: string): string {
  // supabase may be null in demo; fallback to env base
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/storage/v1/object/public/listing-images/${path}`;
  // Even in demo we produce deterministic url; but image_url for demo uses local placeholder.
  return `/storage/listings/${path}`;
}

// For cases where we have client, use its storage helper to ensure correct URL
export function derivePublicUrlFromClient(
  client: { storage: { from: (bucket: string) => { getPublicUrl: (path: string) => { data: { publicUrl: string } } } } },
  path: string
): string {
  return client.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
}
