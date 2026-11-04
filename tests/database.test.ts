import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const seller = "11111111-1111-4111-8111-111111111111";
const buyer = "22222222-2222-4222-8222-222222222222";
const stranger = "33333333-3333-4333-8333-333333333333";
const category = "00000000-0000-4000-8000-000000000003";
let db: PGlite;
let listing: string;
let hidden: string;
let thread: string;
let message: string;
const image = `${seller}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

async function asUser<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${who ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [who ? "authenticated" : "anon"]);
  try { return await db.query<T>(sql, params); }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.query("select set_config('request.jwt.claim.role','',false)"); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
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
  await db.exec(await readFile("supabase/migrations-draft/005_messaging_notifications.sql", "utf8"));
  for (const [id, name] of [[seller, "Seller"], [buyer, "Buyer"], [stranger, "Stranger"]]) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)", [id, `${name.toLowerCase()}@example.test`, JSON.stringify({ full_name: name })]);
  await asUser(seller, "insert into storage.objects(bucket_id,name) values('listing-images',$1)", [image]);
  const create = "insert into public.listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,tags,status) values($1,$2,$3,'A comfortable chair for studying.',1000,'good','Block A',$4,$5,ARRAY['chair','seat'],$6) returning id";
  listing = (await asUser<{ id: string }>(seller, create, [seller, category, "Desk chair", image, `https://example.supabase.co/storage/v1/object/public/listing-images/${image}`, "active"])).rows[0].id;
  hidden = (await asUser<{ id: string }>(seller, create, [seller, category, "Hidden chair", image, `https://example.supabase.co/storage/v1/object/public/listing-images/${image}`, "hidden"])).rows[0].id;
}, 60000);
afterAll(async () => { await db?.close(); });

describe.sequential("real database migrations and RLS", () => {
  it("creates categories and profiles through the signup trigger", async () => {
    expect((await asUser(null, "select * from categories")).rows).toHaveLength(8);
    expect((await asUser(null, "select * from profiles")).rows).toHaveLength(3);
  });
  it("shows active listings publicly while hiding other owners' hidden listings", async () => {
    expect((await asUser(null, "select id from listings order by id")).rows).toHaveLength(1);
    expect((await asUser(buyer, "select id from listings where id=$1", [hidden])).rows).toHaveLength(0);
    expect((await asUser(seller, "select id from listings where id=$1", [hidden])).rows).toHaveLength(1);
  });
  it("prevents another account editing or deleting a listing", async () => {
    expect((await asUser(buyer, "update listings set title='Hacked title' where id=$1 returning id", [listing])).rows).toHaveLength(0);
    expect((await asUser(buyer, "delete from listings where id=$1 returning id", [listing])).rows).toHaveLength(0);
    expect((await asUser(seller, "update listings set price_inr=1100 where id=$1 returning id", [listing])).rows).toHaveLength(1);
  });
  it("blocks forged sellers, categories writes, and another user's image path", async () => {
    await expect(asUser(buyer, "update listings set seller_id=$1 where id=$2", [buyer, listing])).rejects.toThrow();
    await expect(asUser(buyer, "insert into categories(id,slug,name,icon) values(gen_random_uuid(),'fake','Fake','Shapes')")).rejects.toThrow();
    await expect(asUser(buyer, "insert into listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url) values($1,$2,'Forged listing','A long fake description',2,'good','B',$3,$4)", [buyer, category, image, `https://example.supabase.co/storage/v1/object/public/listing-images/${image}`])).rejects.toThrow();
  });
  it("keeps the source photo immutable and prevents deleting referenced uploads", async () => {
    expect((await asUser(seller, "update storage.objects set name='changed' where name=$1 returning id", [image])).rows).toHaveLength(0);
    expect((await asUser(seller, "delete from storage.objects where name=$1 returning id", [image])).rows).toHaveLength(0);
    await expect(asUser(buyer, "insert into storage.objects(bucket_id,name) values('listing-images',$1)", [image])).rejects.toThrow();
  });
  it("full-text search indexes tags and updates after edits", async () => {
    expect((await asUser(null, "select id from listings where search @@ websearch_to_tsquery('english','seat')")).rows).toHaveLength(1);
    await asUser(seller, "update listings set tags=ARRAY['chair','seat','ergonomic'] where id=$1", [listing]);
    expect((await asUser(null, "select id from listings where search @@ websearch_to_tsquery('english','ergonomic')")).rows).toHaveLength(1);
  });
  it("binds a thread to the actual seller and permits only one buyer/listing pair", async () => {
    await expect(asUser(buyer, "insert into threads(listing_id,buyer_id,seller_id) values($1,$2,$3)", [listing, buyer, stranger])).rejects.toThrow();
    thread = (await asUser<{ id: string }>(buyer, "insert into threads(listing_id,buyer_id,seller_id) values($1,$2,$3) returning id", [listing, buyer, seller])).rows[0].id;
    await expect(asUser(buyer, "insert into threads(listing_id,buyer_id,seller_id) values($1,$2,$3)", [listing, buyer, seller])).rejects.toThrow();
    expect((await asUser(stranger, "select id from threads where id=$1", [thread])).rows).toHaveLength(0);
    await expect(asUser(buyer, "update threads set seller_id=$1 where id=$2", [stranger, thread])).rejects.toThrow();
  });
  it("updates inbox ordering in the same transaction as a new message", async () => {
    await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'First message') returning id", [thread, buyer, seller]);
    const result = await asUser<{ updated: boolean }>(buyer, "select t.updated_at = m.created_at as updated from threads t join messages m on m.thread_id=t.id where t.id=$1 order by m.created_at desc limit 1", [thread]);
    expect(result.rows[0].updated).toBe(true);
  });
  it("isolates messages and makes only received read receipts writable", async () => {
    message = (await asUser<{ id: string }>(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'Is it available?') returning id", [thread, buyer, seller])).rows[0].id;
    expect((await asUser(stranger, "select * from messages")).rows).toHaveLength(0);
    await expect(asUser(stranger, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'Injected')", [thread, stranger, seller])).rejects.toThrow();
    await expect(asUser(buyer, "insert into messages(thread_id,sender_id,recipient_id,body) values($1,$2,$3,'Wrong recipient')", [thread, buyer, stranger])).rejects.toThrow();
    await expect(asUser(seller, "update messages set body='Rewritten' where id=$1", [message])).rejects.toThrow();
    expect((await asUser(buyer, "update messages set read_at=now() where id=$1 returning id", [message])).rows).toHaveLength(0);
    expect((await asUser(seller, "update messages set read_at=now() where id=$1 returning id", [message])).rows).toHaveLength(1);
  });
  it("dedupes sends by sender action and bounds read receipts to a visible cursor", async () => {
    const action="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await asUser(buyer,"insert into messages(thread_id,sender_id,recipient_id,body,client_action_id) values($1,$2,$3,'retry safe',$4)",[thread,buyer,seller,action]);
    await expect(asUser(buyer,"insert into messages(thread_id,sender_id,recipient_id,body,client_action_id) values($1,$2,$3,'retry safe',$4)",[thread,buyer,seller,action])).rejects.toThrow();
    const rows=(await asUser<{id:string;created_at:string}>(seller,"select id,created_at from messages where thread_id=$1 and recipient_id=$2 and read_at is null order by created_at,id",[thread,seller])).rows;
    const through=rows[0];
    await asUser(seller,"select mark_thread_read($1,$2,$3)",[thread,through.created_at,through.id]);
    expect((await asUser(seller,"select id from messages where thread_id=$1 and recipient_id=$2 and read_at is null",[thread,seller])).rows.length).toBe(rows.length-1);
    await expect(asUser(stranger,"select mark_thread_read($1,now(),$2)",[thread,through.id])).rejects.toThrow();
  });
  it("returns inbox summaries in one participant-scoped RPC", async () => {
    const buyerRows=await asUser<{id:string;unread_count:number}>(buyer,"select id,unread_count from get_inbox(100)");
    expect(buyerRows.rows.some((row)=>row.id===thread)).toBe(true);
    expect((await asUser(stranger,"select * from get_inbox(100)")).rows).toHaveLength(0);
  });
  it("accepts reports without exposing them to regular users", async () => {
    await asUser(buyer, "insert into reports(listing_id,reporter_id,reason) values($1,$2,'misleading')", [listing, buyer]);
    await expect(asUser(buyer, "select * from reports")).rejects.toThrow();
    await expect(asUser(stranger, "insert into reports(listing_id,reporter_id,reason) values($1,$2,'spam')", [listing, buyer])).rejects.toThrow();
  });
  it("holds prohibited content and prevents seller unhide", async () => {
    await asUser(seller, "update listings set title='Firearm listing' where id=$1", [listing]);
    expect((await asUser(null, "select id from listings where id=$1", [listing])).rows).toHaveLength(0);
    await asUser(seller, "update listings set title='Desk chair',status='active' where id=$1", [listing]);
    expect((await asUser<{ status: string }>(seller, "select status from listings where id=$1", [listing])).rows[0].status).toBe("hidden");
  });
  it("fails closed with AI disabled and no anonymous RPC access", async () => {
    expect((await asUser<{ allowed: boolean }>(buyer, "select * from reserve_ai_usage('draft',50,5)")).rows[0].allowed).toBe(false);
    await expect(asUser(null, "select * from reserve_ai_usage('draft',50,5)")).rejects.toThrow();
    await expect(asUser(buyer, "update ai_budget set enabled=true")).rejects.toThrow();
    await expect(asUser(buyer, "insert into ai_usage(user_id,feature) values($1,'draft')", [buyer])).rejects.toThrow();
  });
  it("counts failed and cross-feature attempts against one user/global budget", async () => {
    await db.exec("update ai_budget set enabled=true,daily_limit=3,per_user_limit=2; update ai_settings set enabled=true");
    const first = (await asUser<{ allowed: boolean; usage_id: string }>(buyer, "select * from reserve_ai_usage('draft',999,999)")).rows[0];
    expect(first.allowed).toBe(true);
    await expect(asUser(stranger, "select complete_ai_usage($1,true,1)", [first.usage_id])).rejects.toThrow();
    await asUser(buyer, "select complete_ai_usage($1,false,10)", [first.usage_id]);
    expect((await asUser<{ allowed: boolean }>(buyer, "select * from reserve_ai_usage('transcribe',999,999)")).rows[0].allowed).toBe(true);
    expect((await asUser<{ reason: string }>(buyer, "select * from reserve_ai_usage('cutout',999,999)")).rows[0].reason).toBe("user_limit");
    expect((await asUser<{ allowed: boolean }>(stranger, "select * from reserve_ai_usage('draft',999,999)")).rows[0].allowed).toBe(true);
    expect((await asUser<{ reason: string }>(seller, "select * from reserve_ai_usage('draft',999,999)")).rows[0].reason).toBe("global_limit");
    expect((await asUser(buyer, "select * from ai_usage")).rows).toHaveLength(2);
  });
});
