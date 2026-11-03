import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

let db: PGlite;
const seller = "11111111-1111-4111-8111-111111111111";
async function asUser(who: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${who ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  try { return await db.query(sql, params as never[]); } finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  await db.exec(await readFile("supabase/migrations-draft/001_initial.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations-draft/002_ai.sql", "utf8"));
  await db.query("insert into auth.users(id,email) values($1,$2)", [seller, "seller@test"]);
  await db.exec(await readFile("docs/drafts/003_ai_budget_hardening.sql", "utf8"));
  await db.exec("update public.ai_budget set enabled=true, daily_limit=100, per_user_limit=10, meta_micro_usd_cap=1000000, baseten_micro_usd_cap=1000000, reserve_micro_usd=200000 where id=true; update public.ai_pricebook set enabled=true");
}, 60000);
afterAll(async () => { await db?.close(); });

describe("candidate budget hardening via docs/drafts explicitly", () => {
  it("reads candidate from docs/drafts and applies without live change", async () => {
    const content = await readFile("docs/drafts/003_ai_budget_hardening.sql", "utf8");
    expect(content).toContain("ai_pricebook");
    expect(content).toContain("reserve_micro_usd");
    expect(content).toContain("revoke all on function public.reserve_ai_usage");
  });
  it("rejects unknown price and enforces server pricebook", async () => {
    await db.exec("update public.ai_pricebook set enabled=false where feature='draft'");
    const r = (await asUser(seller, "select * from public.reserve_ai_attempt('draft','test-key-12345678')")).rows[0] as { allowed: boolean; reason: string };
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("unpriced_feature");
    await db.exec("update public.ai_pricebook set enabled=true where feature='draft'");
  });
  it("deduplicates same idempotency key without new charge", async () => {
    const k = "dup-key-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const a = (await asUser(seller, "select * from public.reserve_ai_attempt('draft',$1)", [k])).rows[0] as { operation_id: string; allowed: boolean; reason: string | null; attempt_id: string };
    expect(a.allowed).toBe(true);
    expect(a.operation_id).toBeTruthy();
    const before = (await asUser(seller, "select count(*) as c from public.ai_attempts where operation_id=$1", [a.operation_id])).rows[0] as { c: number };
    const b = (await asUser(seller, "select * from public.reserve_ai_attempt('draft',$1)", [k])).rows[0] as { operation_id: string; reason: string; attempt_id: string | null };
    expect(b.operation_id).toBe(a.operation_id);
    expect(b.reason).toContain("duplicate");
    expect(b.attempt_id).toBeNull();
    const after = (await asUser(seller, "select count(*) as c from public.ai_attempts where operation_id=$1", [a.operation_id])).rows[0] as { c: number };
    expect(after.c).toBe(before.c);
  });
  it("counts fail/timeout full max and has no refund RPC", async () => {
    const k = "fail-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const r = (await asUser(seller, "select * from public.reserve_ai_attempt('draft',$1)", [k])).rows[0] as { attempt_id: string };
    expect(r.attempt_id).toBeTruthy();
    let used = (await db.query("select meta_micro_usd_used from public.ai_budget where id=true")).rows[0] as { meta_micro_usd_used: number };
    expect(used.meta_micro_usd_used).toBeGreaterThan(0);
    await asUser(seller, "select public.complete_ai_attempt($1,false,100)", [r.attempt_id]);
    used = (await db.query("select meta_micro_usd_used from public.ai_budget where id=true")).rows[0] as { meta_micro_usd_used: number };
    expect(used.meta_micro_usd_used).toBeGreaterThan(0);
    const hasRefund = await db.query("select proname from pg_proc where proname='reconcile_ai_usage'");
    expect(hasRefund.rows.length).toBe(0);
  });
  it("enforces per-provider reserve and pre-listing FK owner check", async () => {
    await db.exec("update public.ai_budget set meta_micro_usd_cap=1000, meta_micro_usd_used=0, reserve_micro_usd=200 where id=true");
    const k1 = "reserve-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const r1 = (await asUser(seller, "select * from public.reserve_ai_attempt('draft',$1)", [k1])).rows[0] as { allowed: boolean; reason: string };
    expect(r1.allowed).toBe(false);
    expect(r1.reason).toBe("budget_exhausted");
    const fakeListing = "00000000-0000-4000-8000-000000000099";
    const r2 = (await asUser(seller, "select * from public.reserve_ai_attempt('draft','key-222233334444',$1)", [fakeListing])).rows[0] as { allowed: boolean; reason: string };
    expect(r2.allowed).toBe(false);
    expect(r2.reason).toBe("listing_forbidden");
    await db.exec("update public.ai_budget set meta_micro_usd_cap=1000000, reserve_micro_usd=200000 where id=true");
  });
  it("revokes old 3-arg RPC from authenticated", async () => {
    await expect(asUser(seller, "select * from public.reserve_ai_usage('draft',50,5)")).rejects.toThrow();
  });
});
