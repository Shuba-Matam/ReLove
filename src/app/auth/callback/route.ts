import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getRequestOrigin, sanitizeNextPath } from "@/lib/server/http";
import { getSupabaseEnv } from "@/lib/server/env";
export async function GET(request:NextRequest) {
 const url = new URL(request.url); const code = url.searchParams.get("code"); const origin = getRequestOrigin(request);
 const next = sanitizeNextPath(url.searchParams.get("next"));
 const response = NextResponse.redirect(new URL(next,origin)); response.headers.set("Cache-Control","private, no-store");
 const fail = () => { response.headers.set("Location",new URL("/login?error=callback",origin).toString()); return response; };
 const {url:supabaseUrl,publishableKey,hasConfig} = getSupabaseEnv(); if(!hasConfig || !code || code.length > 4096) return fail();
 const supabase = createServerClient(supabaseUrl,publishableKey,{cookieOptions:{httpOnly:true,sameSite:"lax",secure:new URL(origin).protocol === "https:",path:"/"},global:{fetch:(input,init) => fetch(input,{...init,signal:init?.signal ?? AbortSignal.timeout(10000)})},cookies:{ getAll:()=>request.cookies.getAll(),setAll:(values)=>{values.forEach(({name,value,options})=>response.cookies.set(name,value,options));} }});
 try { const {error} = await supabase.auth.exchangeCodeForSession(code); if(error) return fail(); } catch { return fail(); }
 return response;
}
