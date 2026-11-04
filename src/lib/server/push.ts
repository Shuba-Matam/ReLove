import "server-only";
import webpush from "web-push";
import { isValidPushEndpoint } from "@/lib/notifications";
import { createSupabaseServiceClient } from "./service-supabase";

export function getPushConfig(){ const publicKey=process.env.VAPID_PUBLIC_KEY?.trim()||""; const privateKey=process.env.VAPID_PRIVATE_KEY?.trim()||""; const subject=process.env.VAPID_SUBJECT?.trim()||""; return {publicKey,privateKey,subject,configured:Boolean(publicKey&&privateKey&&/^(mailto:|https:)/.test(subject))}; }
export async function drainPushOutbox(limit=10):Promise<number>{
  const config=getPushConfig(); const db=createSupabaseServiceClient(); if(!config.configured||!db) return 0;
  webpush.setVapidDetails(config.subject,config.publicKey,config.privateKey); const lease=crypto.randomUUID();
  const {data,error}=await db.rpc("claim_push_outbox",{p_limit:limit,p_lease_owner:lease}); if(error||!data) return 0;
  for(const item of data as Array<Record<string,unknown>>){
    const id=String(item.id); let result:"sent"|"retry"|"cancelled"="retry"; let status:number|null=null;
    const {data:subscription}=await db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,version,revoked_at").eq("id",item.subscription_id).maybeSingle();
    const {data:message}=await db.from("messages").select("id,recipient_id,read_at").eq("id",item.message_id).maybeSingle();
    if(!subscription||subscription.revoked_at||subscription.user_id!==item.recipient_id||subscription.version!==item.subscription_version||!message||message.recipient_id!==item.recipient_id||message.read_at){ result="cancelled"; }
    else if(!isValidPushEndpoint(subscription.endpoint)){ result="cancelled"; }
    else try{
      await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({threadId:item.thread_id,messageId:item.message_id}),{TTL:300,urgency:"high",topic:String(item.message_id).replaceAll("-",""),timeout:8000}); result="sent";
    }catch(caught){ status=typeof caught==="object"&&caught&&"statusCode" in caught?Number((caught as {statusCode:unknown}).statusCode):null; result=status===404||status===410?"cancelled":status===429||Boolean(status&&status>=500)?"retry":"cancelled"; if(status===404||status===410) await db.from("push_subscriptions").update({revoked_at:new Date().toISOString(),version:crypto.randomUUID()}).eq("id",subscription.id); }
    await db.rpc("complete_push_outbox",{p_id:id,p_lease_owner:lease,p_result:result,p_status:status});
  }
  return data.length;
}
