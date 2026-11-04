import "server-only";
import { json, withApi } from "@/lib/server/http";
import { getPushConfig } from "@/lib/server/push";
export const dynamic="force-dynamic";
export const GET=withApi(async()=>{ const config=getPushConfig(); return json({configured:config.configured,publicKey:config.configured?config.publicKey:null}); });
