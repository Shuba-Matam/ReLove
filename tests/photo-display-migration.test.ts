import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

let db: PGlite;
const seller = "11111111-1111-4111-8111-111111111111";
const category = "00000000-0000-4000-8000-000000000003";

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
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  for (const file of ["supabase/migrations-draft/001_initial.sql", "supabase/migrations-draft/002_ai.sql", "docs/drafts/003_ai_budget_hardening.sql", "supabase/migrations-draft/004_listing_photo_display.sql"]) {
    await db.exec(await readFile(file, "utf8"));
  }
}, 60000);

afterAll(async () => { await db?.close(); });

describe("listing photo display migration proposal", () => {
  it("adds explicit display state and source-bound cutout operation", async () => {
    const result = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(`
      select column_name,is_nullable,column_default from information_schema.columns
      where table_schema='public' and table_name='listings' and column_name in ('photo_display_mode','cutout_operation_id')
      order by column_name
    `);
    expect(result.rows).toEqual([
      { column_name: "cutout_operation_id", is_nullable: "YES", column_default: null },
      { column_name: "photo_display_mode", is_nullable: "NO", column_default: "'original'::text" },
    ]);
  });
  it("is safe to re-run during migration recovery", async () => {
    await expect(db.exec(await readFile("supabase/migrations-draft/004_listing_photo_display.sql", "utf8"))).resolves.toBeDefined();
  });
  it("rejects direct cutout attachment without the completed source-bound operation", async () => {
    const imagePath = `${seller}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const cutoutPath = `${seller}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`;
    await db.query("insert into auth.users(id,email) values($1,'seller@example.test') on conflict(id) do nothing", [seller]);
    await db.query("insert into public.profiles(id,display_name) values($1,'Seller') on conflict(id) do nothing", [seller]);
    await db.query("insert into storage.objects(bucket_id,name) values('listing-images',$1),('listing-images',$2)", [imagePath, cutoutPath]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
    try {
      await expect(db.query(`insert into public.listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,cutout_path,cutout_url,photo_display_mode)
        values($1,$2,'Desk chair','A comfortable chair for studying.',1000,'good','A',$3,$4,$5,$6,'cutout')`, [
        seller, category, imagePath,
        `https://example.supabase.co/storage/v1/object/public/listing-images/${imagePath}`,
        cutoutPath,
        `https://example.supabase.co/storage/v1/object/public/listing-images/${cutoutPath}`,
      ])).rejects.toThrow("New cutout requires completed operation");
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  });
  it("rejects an owned done operation whose cached result omits source binding", async () => {
    const imagePath = `${seller}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`;
    const cutoutPath = `${seller}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg`;
    const imageUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${imagePath}`;
    const cutoutUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${cutoutPath}`;
    await db.query("insert into storage.objects(bucket_id,name) values('listing-images',$1),('listing-images',$2)", [imagePath, cutoutPath]);
    await db.exec("set role service_role");
    const operation = await db.query<{ id: string }>(`insert into public.ai_operations(user_id,feature,idempotency_key,source_hash,provider,model,price_micro_usd,status,result,attempt_count)
      values($1,'cutout','malformed-op','1234567890abcdef','meta','sam-3.1',10000,'done',$2::jsonb,1) returning id`, [seller, JSON.stringify({ status: "done", cutout_path: cutoutPath, cutout_url: cutoutUrl })]);
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
    try {
      await expect(db.query(`insert into public.listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,cutout_path,cutout_url,cutout_operation_id,photo_display_mode)
        values($1,$2,'Desk chair','A comfortable chair for studying.',1000,'good','A',$3,$4,$5,$6,$7,'cutout')`, [seller, category, imagePath, imageUrl, cutoutPath, cutoutUrl, operation.rows[0].id]))
        .rejects.toThrow("Cutout operation does not match listing source");
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  });
  it("clears an existing cutout when the original source is replaced without a new operation", async () => {
    const imagePath = `${seller}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg`;
    const nextImagePath = `${seller}/ffffffff-ffff-4fff-8fff-ffffffffffff.jpg`;
    const cutoutPath = `${seller}/99999999-9999-4999-8999-999999999999.jpg`;
    const imageUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${imagePath}`;
    const nextImageUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${nextImagePath}`;
    const cutoutUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${cutoutPath}`;
    await db.query("insert into storage.objects(bucket_id,name) values('listing-images',$1),('listing-images',$2),('listing-images',$3)", [imagePath, nextImagePath, cutoutPath]);
    await db.exec("set role service_role");
    const operation = await db.query<{ id: string }>(`insert into public.ai_operations(user_id,feature,idempotency_key,source_hash,provider,model,price_micro_usd,status,result,attempt_count)
      values($1,'cutout','valid-source-op','abcdef1234567890','meta','sam-3.1',10000,'done',$2::jsonb,1) returning id`, [seller, JSON.stringify({ status: "done", source_image_path: imagePath, cutout_path: cutoutPath, cutout_url: cutoutUrl })]);
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
    try {
      const inserted = await db.query<{ id: string }>(`insert into public.listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url,cutout_path,cutout_url,cutout_operation_id,photo_display_mode,ai_status)
        values($1,$2,'Desk chair','A comfortable chair for studying.',1000,'good','A',$3,$4,$5,$6,$7,'both','done') returning id`, [seller, category, imagePath, imageUrl, cutoutPath, cutoutUrl, operation.rows[0].id]);
      const updated = await db.query<{ cutout_path: string | null; cutout_operation_id: string | null; photo_display_mode: string; ai_status: string }>(
        "update public.listings set image_path=$1,image_url=$2 where id=$3 returning cutout_path,cutout_operation_id,photo_display_mode,ai_status",
        [nextImagePath, nextImageUrl, inserted.rows[0].id],
      );
      expect(updated.rows[0]).toEqual({ cutout_path: null, cutout_operation_id: null, photo_display_mode: "original", ai_status: "none" });
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  });
});
