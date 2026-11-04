"use client";
import * as React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { disablePush,enablePush,getPushPermission,getPushSupport } from "@/lib/client/push";

export function PushOptInCard(){
 const [permission,setPermission]=React.useState<ReturnType<typeof getPushPermission>>(()=>getPushPermission()); const [busy,setBusy]=React.useState(false); const [message,setMessage]=React.useState("");
 const support=typeof window==="undefined"?null:getPushSupport();
 const ios=typeof navigator!=="undefined"&&/iPad|iPhone|iPod/.test(navigator.userAgent); const standalone=typeof window!=="undefined"&&window.matchMedia("(display-mode: standalone)").matches;
 async function enable(){setBusy(true);setMessage("");try{await enablePush();setPermission(getPushPermission());setMessage("Notifications are enabled on this device.");}catch(error){setMessage(error instanceof Error?error.message:"Could not enable notifications.");}finally{setBusy(false);}}
 async function disable(){setBusy(true);setMessage("");try{await disablePush();setMessage("Notifications are off on this device.");}catch{setMessage("Could not turn off notifications.");}finally{setBusy(false);}}
 const unavailable=!support?.supported; const guidance=ios&&!standalone?"On iPhone and iPad, add Re-Love to your Home Screen first, then open the installed app to enable notifications.":support?.reason;
 return <section aria-labelledby="push-optin-heading" className="rounded-xl border border-[#4a3025]/60 bg-[#241712] p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1a100c] ring-1 ring-[#4a3025]"><Bell className="size-4 text-[#bba995]" aria-hidden="true"/></span><div className="min-w-0 flex-1"><h3 id="push-optin-heading" className="text-sm font-medium text-[#f6ead8]">Message notifications</h3><p className="mt-1 text-xs leading-5 text-[#bba995]">Get a simple alert when a new message arrives. Message text is never included.</p>{guidance&&<p className="mt-2 text-xs leading-5 text-[#c9b8a4]">{guidance}</p>}{message&&<p role="status" className="mt-2 text-xs leading-5 text-[#ead7b7]">{message}</p>}<div className="mt-3">{permission==="granted"?<Button type="button" variant="secondary" size="sm" disabled={busy} onClick={()=>void disable()}>{busy?"Updating...":"Turn off"}</Button>:<Button type="button" variant="primary" size="sm" disabled={busy||unavailable||(ios&&!standalone)||permission==="denied"} onClick={()=>void enable()}>{busy?"Enabling...":permission==="denied"?"Blocked in browser":"Enable notifications"}</Button>}</div></div></div></section>;
}
