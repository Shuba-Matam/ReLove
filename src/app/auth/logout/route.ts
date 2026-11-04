import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { ApiProblem, getRequestOrigin, json, withApi } from "@/lib/server/http";
export const POST = withApi(async (request: NextRequest) => {
 const supabase = await createSupabaseServerClient();
 if(supabase) {
  const { error } = await supabase.auth.signOut({ scope:"local" }); if(error) throw new ApiProblem(503,"logout_failed","Could not sign out. Please try again.");
 }
 if(request.headers.get("accept")?.includes("application/json")) return json({signed_out:true});
 return NextResponse.redirect(new URL("/",getRequestOrigin(request)),303);
});
