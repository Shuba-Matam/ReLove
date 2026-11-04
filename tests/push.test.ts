import { afterEach,describe,expect,it,vi } from "vitest";
import { isValidPushEndpoint } from "@/lib/notifications";

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

describe("web push safety and support",()=>{
 it.each(["https://fcm.googleapis.com/fcm/send/a","https://updates.push.services.mozilla.com/wpush/v2/a","https://web.push.apple.com/QP1/a"])("accepts an official push endpoint %s",(endpoint)=>expect(isValidPushEndpoint(endpoint)).toBe(true));
 it.each(["http://fcm.googleapis.com/a","https://evil.example/a","https://127.0.0.1/a","https://fcm.googleapis.com.evil.example/a"])("rejects unsafe endpoint %s",(endpoint)=>expect(isValidPushEndpoint(endpoint)).toBe(false));
 it("uses receiver-safe native fetch for config and persistence",async()=>{
  const calls:string[]=[]; const nativeLike=function(this:unknown,input:RequestInfo|URL){if(this!==globalThis) throw new TypeError("Illegal invocation"); calls.push(String(input)); const payload=String(input).includes("config")?{data:{publicKey:"AQID"}}:{data:{enabled:true}}; return Promise.resolve(new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json"}}));};
  vi.stubGlobal("fetch",nativeLike); vi.stubGlobal("window",{isSecureContext:true,PushManager:function(){},Notification:{permission:"granted",requestPermission:async()=>"granted"}}); vi.stubGlobal("Notification",{permission:"granted",requestPermission:async()=>"granted"});
  const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/a",toJSON:()=>({endpoint:"https://fcm.googleapis.com/fcm/send/a",keys:{p256dh:"p256dh-test-key-material",auth:"auth-test"}})};
  vi.stubGlobal("navigator",{serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}})}});
  const {enablePush}=await import("@/lib/client/push"); await enablePush(); expect(calls).toEqual(["/api/push/config","/api/push/subscriptions"]);
 });
});
