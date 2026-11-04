import { describe, expect, it } from "vitest";
import { failedMessage, mergeMessages, type DisplayMessage } from "@/lib/client/messaging-state";

const base: DisplayMessage = { id:"11111111-1111-4111-8111-111111111111",thread_id:"22222222-2222-4222-8222-222222222222",sender_id:"33333333-3333-4333-8333-333333333333",recipient_id:"44444444-4444-4444-8444-444444444444",body:"Hello",created_at:"2026-11-05T00:00:00.000Z",read_at:null };

describe("messaging state", () => {
  it("reconciles an optimistic message by action id without duplicates", () => {
    const optimistic={...base,id:"55555555-5555-4555-8555-555555555555",client_action_id:"55555555-5555-4555-8555-555555555555",delivery:"pending" as const};
    const saved={...base,id:"66666666-6666-4666-8666-666666666666",client_action_id:optimistic.client_action_id};
    expect(mergeMessages([optimistic],[saved])).toEqual([saved]);
  });
  it("merges updates by UUID and keeps deterministic timestamp/id order", () => {
    const second={...base,id:"77777777-7777-4777-8777-777777777777",created_at:base.created_at,body:"Second"};
    const read={...base,read_at:"2026-11-05T00:01:00.000Z"};
    expect(mergeMessages([second,base],[read])).toEqual([read,second]);
  });
  it("keeps failed content and idempotency key available for retry", () => {
    const action={...base,client_action_id:base.id,delivery:"pending" as const};
    expect(failedMessage([action],base.id,"Offline")[0]).toMatchObject({body:"Hello",client_action_id:base.id,delivery:"failed",error:"Offline"});
  });
});
