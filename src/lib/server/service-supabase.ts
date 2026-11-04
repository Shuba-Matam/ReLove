import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

export function createSupabaseServiceClient() {
  const { url }=getSupabaseEnv(); const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key) return null;
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch.call(globalThis,input,{...init,redirect:"error",signal:init?.signal??AbortSignal.timeout(10_000)})}});
}
