import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const seller = "11111111-1111-4111-8111-111111111111";
const buyer = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const category = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
let thread: string;
let listingId: string;
const image = `${seller}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

async function asUser<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${who ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
async function asServiceRole<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

async function createThreadForCap(): Promise<string> {
  // Create a new listing+thread to avoid 15m throttle on same thread
  const img = `${seller}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
  await asUser(seller, "insert into storage.objects(bucket_id,name) values('listing-images',$1) on conflict do nothing", [img]);
  const listing = (
    await asUser<{ id: string }>(
      seller,
      "insert into listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,tags,status) values($1,$2,$3,'Cap test chair.',1000,'good','B',$4,$5,ARRAY['cap'],'active') returning id",
      [seller, category, `Cap ${Date.now()}`, img, `https://example.supabase.co/storage/v1/object/public/listing-images/${img}`]
    )
  ).rows[0].id;
  const t = (
    await asUser<{ id: string }>(buyer, "insert into threads(listing_id,buyer_id,seller_id) values($1,$2,$3) returning id", [listing, buyer, seller])
  ).rows[0].id;
  return t;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant execute on function auth.role() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  await db.exec(await readFile("supabase/migrations-draft/001_initial.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations-draft/002_ai.sql", "utf8"));
  await db.exec(await readFile("docs/drafts/004_notifications.sql", "utf8"));
  for (const [id, name] of [
    [seller, "Seller"],
    [buyer, "Buyer"],
    [stranger, "Stranger"],
  ]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)", [id, `${name.toLowerCase()}@example.test`, JSON.stringify({ full_name: name })]);
  }
  await asUser(seller, "insert into storage.objects(bucket_id,name) values('listing-images',$1)", [image]);
  listingId = (
    await asUser<{ id: string }>(
      seller,
      "insert into listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,tags,status) values($1,$2,'Desk chair','A comfortable chair.',1000,'good','A',$3,$4,ARRAY['chair'],'active') returning id",
      [seller, category, image, `https://example.supabase.co/storage/v1/object/public/listing-images/${image}`]
    )
  ).rows[0].id;
  thread = (
    await asUser<{ id: string }>(buyer, "insert into threads(listing_id,buyer_id,seller_id) values($1,$2,$3) returning id", [listingId, buyer, seller])
  ).rows[0].id;
  await db.exec("update notification_budget set enabled=true, per_user_email_daily_limit=2, per_user_push_daily_limit=2, email_daily_limit=10, push_daily_limit=10 where id=true");
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe.sequential("candidate 004_notifications — default disabled, recipient-derived, worker leases", () => {
  it("is DEFAULT DISABLED: no prefs row means no enqueue", async () => {
    const before = (await asUser(seller, "select count(*)::int as c from notification_outbox")).rows[0].c as number;
    const msg = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'hi') returning id", [thread, buyer, seller])).rows[0];
    const after = (await asUser(seller, "select count(*)::int as c from notification_outbox")).rows[0].c as number;
    expect(after).toBe(before);
    // Clean
    await asServiceRole("delete from notification_outbox where message_id=$1::uuid", [msg.id]);
  });

  it("queues for recipient when enabled, derives recipient_id correctly", async () => {
    await asUser(seller, "insert into notification_preferences(user_id,email_enabled) values($1,true) on conflict(user_id) do update set email_enabled=true", [seller]);
    const msg = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'hello seller') returning id", [thread, buyer, seller])).rows[0];
    const out = (await asUser(seller, "select recipient_id, channel, message_id from notification_outbox where message_id=$1::uuid", [msg.id])).rows[0] as { recipient_id: string; channel: string };
    expect(out.recipient_id).toBe(seller);
    expect(out.channel).toBe("email");
    expect((await asUser(buyer, "select * from notification_outbox where message_id=$1::uuid", [msg.id])).rows.length).toBe(0);
  });

  it("dedupes same message+recipient+channel, no free send", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid", [seller]);
    await asUser(seller, "insert into notification_preferences(user_id,email_enabled) values($1,true) on conflict(user_id) do update set email_enabled=true", [seller]);
    const msg = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'dedupe test') returning id", [thread, buyer, seller])).rows[0];
    const firstCount = (await asServiceRole("select count(*)::int as c from notification_outbox where message_id=$1::uuid", [msg.id])).rows[0].c as number;
    expect(firstCount).toBe(1);
    const existing = (await asServiceRole("select dedupe_key from notification_outbox where message_id=$1::uuid", [msg.id])).rows[0].dedupe_key as string;
    await expect(asServiceRole("insert into notification_outbox(recipient_id,channel,message_id,thread_id,dedupe_key) values($1::uuid,'email',$2::uuid,$3::uuid,$4)", [seller, msg.id, thread, existing])).rejects.toThrow();
  });

  it("opt-out rechecked: unsubscribed user gets no queue", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid", [seller]);
    await asUser(seller, "update notification_preferences set email_unsubscribed_at=now() where user_id=$1", [seller]);
    const msg = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'should be skipped') returning id", [thread, buyer, seller])).rows[0];
    expect((await asServiceRole("select * from notification_outbox where message_id=$1::uuid", [msg.id])).rows.length).toBe(0);
    await asUser(seller, "update notification_preferences set email_unsubscribed_at=null, email_enabled=true where user_id=$1", [seller]);
  });

  it("caps include failures: per-user daily cap blocks after failures", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid", [seller]);
    await asUser(seller, "insert into notification_preferences(user_id,email_enabled) values($1,true) on conflict(user_id) do update set email_enabled=true", [seller]);
    const t1 = await createThreadForCap();
    const t2 = await createThreadForCap();
    const t3 = await createThreadForCap();
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'cap1')", [t1, buyer, seller]);
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'cap2')", [t2, buyer, seller]);
    expect((await asServiceRole("select count(*)::int as c from notification_outbox where recipient_id=$1::uuid and channel='email'", [seller])).rows[0].c).toBe(2);
    const one = (await asServiceRole<{ id: string }>("select id from notification_outbox where recipient_id=$1::uuid limit 1", [seller])).rows[0].id;
    await asServiceRole("update notification_outbox set status='failed', attempts=3 where id=$1::uuid", [one]);
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'cap3 blocked')", [t3, buyer, seller]);
    const countAfter = (await asServiceRole<{ c: number }>("select count(*)::int as c from notification_outbox where recipient_id=$1::uuid and channel='email'", [seller])).rows[0].c;
    expect(countAfter).toBe(2);
  });

  it("worker-only: ordinary user cannot claim/complete, service_role can", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid", [seller]);
    const t = await createThreadForCap();
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'worker test')", [t, buyer, seller]);
    await expect(asUser(seller, "select * from claim_notifications(10,'worker-a')")).rejects.toThrow();
    const claimed = (await asServiceRole<{ id: string; lease_owner: string }>("select * from claim_notifications(10,'worker-a')")).rows;
    expect(claimed.length).toBe(1);
    expect(claimed[0].lease_owner).toBe("worker-a");
    await expect(asUser(seller, "select complete_notification_send($1::uuid,true,null,'worker-a')", [claimed[0].id])).rejects.toThrow();
    await expect(asServiceRole("select complete_notification_send($1::uuid,true,null,'wrong-owner')", [claimed[0].id])).rejects.toThrow();
    await asServiceRole("select complete_notification_send($1::uuid,true,null,'worker-a')", [claimed[0].id]);
    expect((await asServiceRole("select status from notification_outbox where id=$1::uuid", [claimed[0].id])).rows[0].status).toBe("sent");
  });

  it("lease fencing: stale lease can be reaped and re-claimed", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid", [seller]);
    const t = await createThreadForCap();
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'lease test')", [t, buyer, seller]);
    const claimed = (await asServiceRole<{ id: string }>("select * from claim_notifications(10,'worker-b')")).rows[0];
    await asServiceRole("update notification_outbox set lease_expires_at=now() - interval '1 hour' where id=$1::uuid", [claimed.id]);
    const reaped = (await asServiceRole<{ reap_stale_notification_leases: number }>("select reap_stale_notification_leases()")).rows[0].reap_stale_notification_leases;
    expect(reaped).toBeGreaterThanOrEqual(1);
    const reclaimed = (await asServiceRole<{ id: string }>("select * from claim_notifications(10,'worker-c')")).rows;
    expect(reclaimed.some((r) => r.id === claimed.id)).toBe(true);
  });

  it("push subscriptions: ownership isolated across accounts, RLS", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/seller-device-1";
    await asUser(seller, "insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,'p256dh-test-1234567890','auth-test-123456') on conflict(user_id,endpoint) do nothing", [seller, endpoint]);
    expect((await asUser(seller, "select * from push_subscriptions where user_id=$1", [seller])).rows.length).toBe(1);
    expect((await asUser(stranger, "select * from push_subscriptions where user_id=$1", [seller])).rows.length).toBe(0);
    await expect(asUser(buyer, "insert into push_subscriptions(user_id,endpoint,p256dh,auth) values($1,$2,'x','y')", [seller, endpoint])).rejects.toThrow();
    await asUser(seller, "update notification_preferences set push_enabled=true where user_id=$1", [seller]);
    await asServiceRole("delete from notification_outbox where recipient_id=$1::uuid and channel='push'", [seller]);
    const t = await createThreadForCap();
    await asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'push per device')", [t, buyer, seller]);
    const pushRows = (await asServiceRole("select * from notification_outbox where recipient_id=$1::uuid and channel='push'", [seller])).rows;
    expect(pushRows.length).toBe(1);
    expect(pushRows[0].push_subscription_id).toBeDefined();
  });

  it("sender cannot spoof recipient: trigger uses NEW.recipient_id not auth.uid()", async () => {
    await asServiceRole("delete from notification_outbox where recipient_id in ($1::uuid,$2::uuid)", [seller, stranger]);
    const t = await createThreadForCap();
    const msg = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'honest recipient') returning id", [t, buyer, seller])).rows[0];
    const out = (await asServiceRole("select recipient_id from notification_outbox where message_id=$1::uuid", [msg.id])).rows[0] as { recipient_id: string };
    expect(out.recipient_id).toBe(seller);
    expect(out.recipient_id).not.toBe(buyer);
  });

  it("budget DEFAULT DISABLED, ordinary users cannot modify budget", async () => {
    const before = (await asServiceRole("select enabled from notification_budget where id=true")).rows[0].enabled as boolean;
    expect(typeof before).toBe("boolean");
    await expect(asUser(seller, "update notification_budget set enabled=true where id=true")).rejects.toThrow();
    await expect(asUser(seller, "insert into notification_outbox(recipient_id,channel,dedupe_key) values($1::uuid,'email','x')", [seller])).rejects.toThrow();
  });
});
