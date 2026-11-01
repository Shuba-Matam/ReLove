import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { getAppMode, isAuthConfigured } from "@/lib/server/env";
import { getRequestOrigin, sanitizeNextPath } from "@/lib/server/http";
export async function GET(request:NextRequest) {
 const origin = getRequestOrigin(request); const next = sanitizeNextPath(new URL(request.url).searchParams.get("next"));
 const failure = () => { const response = NextResponse.redirect(new URL("/login?error=unavailable",origin)); response.headers.set("Cache-Control","private, no-store"); return response; };
 if(getAppMode() !== "live" || !isAuthConfigured()) return failure();
 try { const supabase = await createSupabaseServerClient(); if(!supabase) return failure();
 const { data,error } = await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:origin+"/auth/callback?next="+encodeURIComponent(next)}});
 if(error || !data.url) return failure(); const response = NextResponse.redirect(data.url); response.headers.set("Cache-Control","private, no-store"); return response;
 } catch { return failure(); }
}
