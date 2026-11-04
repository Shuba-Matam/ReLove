import "server-only";
import { NextRequest } from "next/server";
import { ApiProblem,json,withApi } from "@/lib/server/http";
import { drainPushOutbox } from "@/lib/server/push";
export const POST=withApi(async(request:NextRequest)=>{ const expected=process.env.PUSH_DRAIN_SECRET?.trim(); const actual=request.headers.get("authorization"); if(!expected||actual!==`Bearer ${expected}`) throw new ApiProblem(401,"unauthorized","Authentication required."); return json({claimed:await drainPushOutbox(25)}); });
