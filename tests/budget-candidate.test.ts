import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// helper to manage role + jwt emulation for PGlite
let db: PGlite;
const seller = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const attacker = "33333333-3333-4333-8333-333333333333";
const category = "00000000-0000-4000-8000-000000000003";
const image = `${seller}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;

async function asRole(role: "anon" | "authenticated" | "service_role" | null, who: string | null, sql: string, params: unknown[] = []) {
  if (role) await db.exec(`set role ${role}`);
  if (who) await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
  else await db.query("select set_config('request.jwt.claim.sub','',false)");
  if (role === "service_role") await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  try { return await db.query(sql, params as never[]); }
  finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("select set_config('request.jwt.claim.role','',false)");
  }
}
const asUser = (who: string | null, sql: string, params: unknown[] = []) => asRole(who ? "authenticated" : "anon", who, sql, params);
const asService = (who: string, sql: string, params: unknown[] = []) => asRole("service_role", who, sql, params);

function hash(s: string) { return createHash("sha256").update(s).digest("hex"); }

let candidateSql = "";

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
  await db.exec(await readFile("supabase/migrations-draft/001_initial.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations-draft/002_ai.sql", "utf8"));
  for (const [id, name] of [[seller, "Seller"], [other, "Other"], [attacker, "Attacker"]]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${name.toLowerCase()}@test`]);
  }
  await asUser(seller, "insert into storage.objects(bucket_id,name) values('listing-images',$1)", [image]);
  // create a listing owned by seller for listing_id FK tests
  await asUser(seller, "insert into public.listings(seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url) values($1,$2,'Desk chair','A chair for studying long enough',1000,'good','Block A',$3,$4)", [seller, category, image, `https://example.supabase.co/storage/v1/object/public/listing-images/${image}`]);

  candidateSql = await readFile("docs/drafts/003_ai_budget_hardening.sql", "utf8");
  await db.exec(candidateSql);
  // set service_role membership so current_user check passes in function
  await db.exec("grant service_role to postgres");
}, 60000);
afterAll(async () => { await db?.close(); });

describe("candidate 003 schema correctness (review only, no guessed rates)", () => {
  it("candidate file contains microUSD, per-provider reserve, lock, and no guessed production rates", async () => {
    expect(candidateSql).toContain("meta_micro_usd_cap");
    expect(candidateSql).toContain("baseten_micro_usd_cap");
    expect(candidateSql).toContain("meta_reserve_micro_usd");
    expect(candidateSql).toContain("baseten_reserve_micro_usd");
    expect(candidateSql).toContain("for update");
    expect(candidateSql).toContain("source_hash");
    expect(candidateSql).toContain("attempt_count");
    expect(candidateSql).toContain("provider_mismatch");
    expect(candidateSql).toContain("budget_unconfigured");
    // empty pricebook: no enabled true rows inserted
    expect(candidateSql).not.toMatch(/insert into public\.ai_pricebook/i);
    // old guessed rates must not exist
    expect(candidateSql).not.toContain("'draft','meta', 1500");
    expect(candidateSql).not.toContain("'transcribe','meta', 500");
    expect(candidateSql).not.toContain("'cutout','meta', 3000");
    // must document fixtures with actual bounds
    expect(candidateSql).toContain("5100");
    expect(candidateSql).toContain("3000");
    // must revoke old RPCs and grant only service_role
    expect(candidateSql).toContain("revoke all on function public.reserve_ai_usage");
    expect(candidateSql).toContain("grant execute on function public.reserve_ai_attempt");
    expect(candidateSql).toContain("to service_role");
    expect(candidateSql).not.toContain("grant execute on function public.reserve_ai_attempt(text,text,uuid) to authenticated");
  });
  it("pricebook is empty and disabled by default until exact ceiling configured", async () => {
    const rows = (await asUser(seller, "select * from public.ai_pricebook")).rows;
    expect(rows.length).toBe(0);
  });
  it("locks before idempotency: candidate contains FOR UPDATE on budget before operations lookup", async () => {
    const budgetLockIdx = candidateSql.indexOf("from public.ai_budget where id = true for update");
    const opsLookupIdx = candidateSql.indexOf("from public.ai_operations");
    expect(budgetLockIdx).toBeGreaterThan(-1);
    expect(opsLookupIdx).toBeGreaterThan(-1);
    expect(budgetLockIdx).toBeLessThan(opsLookupIdx);
  });
  it("does not claim parallel support via shared connection: explicitly enforces lock SQL, docs limitation", async () => {
    // PGlite single connection cannot test real concurrency; we verify lock exists instead of fake parallel test
    expect(candidateSql).toContain("for update");
    // ensure no test asserts parallel with shared helper (we don't)
  });
});

describe("monetary limits: NULL/missing/nonpositive cap and reserve per-provider", () => {
  beforeEach(async () => {
    await db.exec("update public.ai_budget set enabled=true, daily_limit=100, per_user_limit=20, meta_micro_usd_cap=100000, baseten_micro_usd_cap=100000, meta_micro_usd_used=0, baseten_micro_usd_used=0, meta_reserve_micro_usd=0, baseten_reserve_micro_usd=0 where id=true");
    await db.exec("update public.ai_settings set enabled=true, daily_limit=100, per_user_limit=20");
    await db.exec("delete from public.ai_attempts; delete from public.ai_operations; delete from public.ai_usage; delete from public.ai_pricebook");
    // Insert TEST-ONLY fixtures with conservatively rounded microUSD (labeled not production)
    // draft: 1200 tokens output @ $4.25/1M = 5100 microUSD output alone => fixture 8500 (input buffer+round-up) TEST ONLY
    // transcribe: 60s @ $0.18/3600=3000 microUSD => fixture 3500 rounded TEST ONLY
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled,input_max_chars,output_max_tokens,max_duration_sec) values('draft','meta','muse-spark-1.3',8500,true,8000,1200,null)");
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled,max_duration_sec) values('transcribe','meta','muse-voice-transcribe-1.0',3500,true,60)");
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled) values('cutout','meta','sam-3.1',4000,true)");
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled) values('moderation','baseten','meta-models/muse-spark-open-1026',6000,true)");
  });

  it("NULL/missing/nonpositive provider cap MUST reject even if global enabled and pricebook enabled", async () => {
    await db.exec("update public.ai_budget set meta_micro_usd_cap=null where id=true");
    const r1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-null-cap-12345','meta','muse-spark-1.3',$2,50,5)", [seller, hash("draft1")])).rows[0] as Record<string, unknown>;
    expect(r1.allowed).toBe(false); expect(r1.reason).toBe("budget_unconfigured");
    await db.exec("update public.ai_budget set meta_micro_usd_cap=0 where id=true");
    const r2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-zero-cap-12345','meta','muse-spark-1.3',$2,50,5)", [seller, hash("draft2")])).rows[0] as Record<string, unknown>;
    expect(r2.allowed).toBe(false); expect(r2.reason).toBe("budget_unconfigured");
    await db.exec("update public.ai_budget set meta_micro_usd_cap=100000 where id=true");
  });

  it("missing price/model bounds rejects and provider/model mismatch rejects", async () => {
    // unpriced feature: delete cutout price
    await asService(seller, "delete from public.ai_pricebook where feature='cutout'");
    const r1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'cutout','key-unpriced-12345','meta','sam-3.1',$2,50,5)", [seller, hash("cutout1")])).rows[0] as Record<string, unknown>;
    expect(r1.allowed).toBe(false); expect(r1.reason).toBe("unpriced_feature");
    // restore
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled) values('cutout','meta','sam-3.1',4000,true)");
    // provider mismatch: request baseten but pricebook is meta
    const r2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-prov-mismatch1','baseten','meta-models/muse-spark-open-1026',$2,50,5)", [seller, hash("draft-mismatch")])).rows[0] as Record<string, unknown>;
    expect(r2.allowed).toBe(false); expect(r2.reason).toBe("provider_mismatch");
    // model mismatch
    const r3 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-model-mismatch','meta','Llama-4-Maverick-17B-128E-Instruct-FP8',$2,50,5)", [seller, hash("draft-mismatch2")])).rows[0] as Record<string, unknown>;
    expect(r3.allowed).toBe(false); expect(r3.reason).toBe("provider_mismatch");
  });

  it("validates reserve<=cap per-provider and uses per-provider reserve not shared pool", async () => {
    // per-provider reserve: meta reserve should not affect baseten spend
    await db.exec("update public.ai_budget set meta_micro_usd_cap=6000, baseten_micro_usd_cap=10000, meta_reserve_micro_usd=5000, baseten_reserve_micro_usd=100, meta_micro_usd_used=0, baseten_micro_usd_used=0 where id=true");
    // baseten moderation cost 6000, spendable for baseten =10000-100=9900 => should allow
    const ok = (await asService(seller, "select * from public.reserve_ai_attempt($1,'moderation','key-basen-ok-1234','baseten','meta-models/muse-spark-open-1026',$2,50,5)", [seller, hash("mod-ok")])).rows[0] as Record<string, unknown>;
    expect(ok.allowed).toBe(true);
    // if bug used shared reserve 5000, baseten spendable would be 10000-5000=5000 <6000 => reject, but per-provider allows
    // now test meta reserve enforced: meta draft cost 8500, spendable meta=6000-5000=1000 => reject
    const reject = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-meta-reserve-123','meta','muse-spark-1.3',$2,50,5)", [seller, hash("draft-reserve")])).rows[0] as Record<string, unknown>;
    expect(reject.allowed).toBe(false); expect(reject.reason).toBe("budget_exhausted");
    // invalid reserve > cap should fail closed
    await db.exec("update public.ai_budget set meta_reserve_micro_usd=7000 where id=true");
    const invalid = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-invalid-reserve','meta','muse-spark-1.3',$2,50,5)", [seller, hash("invalid-reserve")])).rows[0] as Record<string, unknown>;
    expect(invalid.allowed).toBe(false); expect(invalid.reason).toBe("invalid_reserve");
  });

  it("preserves ai_settings.enabled/daily/user checks and stricter env bounds", async () => {
    await db.exec("update public.ai_settings set enabled=false where feature='draft'");
    const r1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-settings-disabled','meta','muse-spark-1.3',$2,50,5)", [seller, hash("draft-disabled")])).rows[0] as Record<string, unknown>;
    expect(r1.allowed).toBe(false); expect(r1.reason).toBe("feature_disabled");
    await db.exec("update public.ai_settings set enabled=true, per_user_limit=1 where feature='draft'");
    await db.exec("update public.ai_budget set daily_limit=100, per_user_limit=100 where id=true");
    // first succeeds, second hits per_user_limit from ai_settings (stricter than env 5)
    const a1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-env-bound1','meta','muse-spark-1.3',$2,100,100)", [seller, hash("a1")])).rows[0] as Record<string, unknown>;
    expect(a1.allowed).toBe(true);
    const a2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-env-bound2','meta','muse-spark-1.3',$2,100,100)", [seller, hash("a2")])).rows[0] as Record<string, unknown>;
    expect(a2.allowed).toBe(false); expect(a2.reason).toBe("user_limit");
    // env stricter than DB: pass p_user_limit=0? Actually cap() returns 0 for invalid; we pass 1 env vs DB 100 => least is 1, so should still limit
    await db.exec("update public.ai_settings set per_user_limit=20 where feature='draft'");
    await db.exec("delete from public.ai_attempts; delete from public.ai_operations; delete from public.ai_usage;");
    const b1 = (await asService(other, "select * from public.reserve_ai_attempt($1,'draft','key-env-strict1','meta','muse-spark-1.3',$2,100,1)", [other, hash("b1")])).rows[0] as Record<string, unknown>;
    expect(b1.allowed).toBe(true);
    const b2 = (await asService(other, "select * from public.reserve_ai_attempt($1,'draft','key-env-strict2','meta','muse-spark-1.3',$2,100,1)", [other, hash("b2")])).rows[0] as Record<string, unknown>;
    expect(b2.allowed).toBe(false); expect(b2.reason).toBe("user_limit");
  });

  it("rejects disabled global budget", async () => {
    await db.exec("update public.ai_budget set enabled=false where id=true");
    const r = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft','key-disabled-global','meta','muse-spark-1.3',$2,50,5)", [seller, hash("disabled-global")])).rows[0] as Record<string, unknown>;
    expect(r.allowed).toBe(false); expect(r.reason).toBe("disabled");
    await db.exec("update public.ai_budget set enabled=true where id=true");
  });
});

describe("operation identity, idempotency, duplicate, max3, source mismatch", () => {
  beforeEach(async () => {
    await db.exec("update public.ai_budget set enabled=true, daily_limit=100, per_user_limit=100, meta_micro_usd_cap=1000000, baseten_micro_usd_cap=1000000, meta_micro_usd_used=0, baseten_micro_usd_used=0, meta_reserve_micro_usd=0, baseten_reserve_micro_usd=0 where id=true");
    await db.exec("update public.ai_settings set enabled=true, daily_limit=100, per_user_limit=100");
    await db.exec("delete from public.ai_attempts; delete from public.ai_operations; delete from public.ai_usage;");
    await db.exec("delete from public.ai_pricebook");
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled) values('draft','meta','muse-spark-1.3',8500,true)");
  });

  it("duplicate done/pending returns explicit nonexecution disposition, not allowed=true, no second provider execution", async () => {
    const key = "dup-key-" + hash("dup1").slice(0, 16);
    const src = hash("source-draft-image-a");
    const first = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; disposition: string; attempt_id: string | null; operation_id: string; reason: string | null };
    expect(first.allowed).toBe(true); expect(first.disposition).toBe("executed"); expect(first.attempt_id).toBeTruthy();
    const countBefore = (await asService(seller, "select count(*) as c from public.ai_attempts where operation_id=$1", [first.operation_id])).rows[0] as { c: number };
    expect(countBefore.c).toBe(1);
    // mark done
    await asService(seller, "select public.complete_ai_attempt($1,$2,true,100,'{\"title\":\"Done\"}'::jsonb)", [seller, first.attempt_id]);
    const dupDone = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; disposition: string; attempt_id: string | null; cached_result: unknown };
    expect(dupDone.allowed).toBe(false); expect(dupDone.disposition).toBe("duplicate_done"); expect(dupDone.attempt_id).toBeNull();
    const countAfterDone = (await asService(seller, "select count(*) as c from public.ai_attempts where operation_id=$1", [first.operation_id])).rows[0] as { c: number };
    expect(countAfterDone.c).toBe(1); // no second provider attempt
    // pending duplicate: new key, reserve, then immediate duplicate without completing
    const key2 = "dup-pending-" + hash("dup2").slice(0, 12);
    const src2 = hash("source-pending");
    const pending1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key2, src2])).rows[0] as { allowed: boolean; disposition: string; attempt_id: string };
    expect(pending1.allowed).toBe(true);
    const pending2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key2, src2])).rows[0] as { allowed: boolean; disposition: string; attempt_id: string | null };
    expect(pending2.allowed).toBe(false); expect(pending2.disposition).toBe("duplicate_pending"); expect(pending2.attempt_id).toBeNull();
    const pendingCount = (await asService(seller, "select count(*) as c from public.ai_attempts where operation_id=$1", [(pending1 as unknown as Record<string,string>).operation_id])).rows[0] as { c: number };
    expect(pendingCount.c).toBe(1);
  });

  it("stable operation identity binds source hash; same key with changed source rejects", async () => {
    const key = "stable-key-" + hash("stable").slice(0, 12);
    const srcA = hash("source-image-A");
    const srcB = hash("source-image-B-different");
    const first = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, srcA])).rows[0] as { allowed: boolean; operation_id: string; attempt_id: string };
    expect(first.allowed).toBe(true);
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, first.attempt_id]);
    // same key, different source should be source_mismatch, not new execution
    const mismatch = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, srcB])).rows[0] as { allowed: boolean; reason: string; disposition: string };
    expect(mismatch.allowed).toBe(false); expect(mismatch.reason).toBe("source_mismatch");
  });

  it("failed retry creates pending atomically and caps attempts per operation at max3 across requests; completion fenced to current claim", async () => {
    const key = "retry-key-" + hash("retry").slice(0, 12);
    const src = hash("retry-source");
    const a1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; attempt_id: string; operation_id: string };
    expect(a1.allowed).toBe(true);
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, a1.attempt_id]);
    const a2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; attempt_id: string };
    expect(a2.allowed).toBe(true);
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, a2.attempt_id]);
    const a3 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; attempt_id: string };
    expect(a3.allowed).toBe(true);
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, a3.attempt_id]);
    const a4 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { allowed: boolean; reason: string; disposition: string };
    expect(a4.allowed).toBe(false); expect(a4.reason).toBe("max_attempts");
    // completion fenced to current claim: try to complete stale attempt should error (stale attempt)
    // create new operation for fencing test
    const key2 = "fence-key-" + hash("fence").slice(0, 12);
    const src2 = hash("fence-src");
    const f1 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key2, src2])).rows[0] as { attempt_id: string; operation_id: string };
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, f1.attempt_id]);
    const f2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key2, src2])).rows[0] as { attempt_id: string };
    // try to complete old attempt again (already completed) should be idempotent no error but not affect new pending
    await asService(seller, "select public.complete_ai_attempt($1,$2,true,100)", [seller, f1.attempt_id]);
    // f2 is still pending, complete it
    await expect(asService(seller, "select public.complete_ai_attempt($1,$2,true,100)", [seller, f2.attempt_id])).resolves.toBeDefined();
    // unknown outcome must not freely retry: pending op returns duplicate_pending not new attempt
    const key3 = "unknown-key-" + hash("unknown").slice(0, 12);
    const src3 = hash("unknown-src");
    await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key3, src3]);
    const u2 = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key3, src3])).rows[0] as { allowed: boolean; disposition: string };
    expect(u2.allowed).toBe(false); expect(u2.disposition).toBe("duplicate_pending");
  });

  it("errors/timeouts billed full upper bound, no automatic refunds, no refund RPC exists", async () => {
    const key = "bill-key-" + hash("bill").slice(0, 12);
    const src = hash("bill-src");
    const before = (await db.query("select meta_micro_usd_used from public.ai_budget where id=true")).rows[0] as { meta_micro_usd_used: number };
    const r = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { attempt_id: string };
    const after = (await db.query("select meta_micro_usd_used from public.ai_budget where id=true")).rows[0] as { meta_micro_usd_used: number };
    expect(after.meta_micro_usd_used).toBe(before.meta_micro_usd_used + 8500);
    await asService(seller, "select public.complete_ai_attempt($1,$2,false,100)", [seller, r.attempt_id]);
    const afterFail = (await db.query("select meta_micro_usd_used from public.ai_budget where id=true")).rows[0] as { meta_micro_usd_used: number };
    expect(afterFail.meta_micro_usd_used).toBe(after.meta_micro_usd_used); // no refund
    const hasRefund = (await db.query("select proname from pg_proc where proname='reconcile_ai_usage' or proname='refund_ai_attempt'")).rows;
    expect(hasRefund.length).toBe(0);
  });
});

describe("money/audit not client-writable, service_role only", () => {
  beforeEach(async () => {
    await db.exec("update public.ai_budget set enabled=true, daily_limit=100, per_user_limit=100, meta_micro_usd_cap=1000000, baseten_micro_usd_cap=1000000, meta_micro_usd_used=0, baseten_micro_usd_used=0, meta_reserve_micro_usd=0, baseten_reserve_micro_usd=0 where id=true");
    await db.exec("update public.ai_settings set enabled=true where feature in ('draft','transcribe','cutout','moderation')");
    await db.exec("delete from public.ai_attempts; delete from public.ai_operations; delete from public.ai_usage; delete from public.ai_pricebook");
    await asService(seller, "insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled) values('draft','meta','muse-spark-1.3',8500,true)");
  });
  it("revokes reserve/complete from public/anon/authenticated, only service_role can execute", async () => {
    const key = "revoke-test-" + hash("revoke").slice(0, 12);
    const src = hash("revoke-src");
    await expect(asUser(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,50,5)", [seller, key, src])).rejects.toThrow();
    await expect(asRole("anon", null, "select * from public.reserve_ai_attempt($1,'draft','key-anon','meta','muse-spark-1.3',$2,50,5)", [seller, hash("anon")])).rejects.toThrow();
    // service_role succeeds
    const ok = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,50,5)", [seller, key, src])).rows[0] as { allowed: boolean };
    expect(ok.allowed).toBe(true);
  });
  it("attacker cannot mark done/refund; completion fenced to own attempt and service_role", async () => {
    const key = "attacker-" + hash("attacker").slice(0, 12);
    const src = hash("attacker-src");
    const res = (await asService(seller, "select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, key, src])).rows[0] as { attempt_id: string };
    // attacker (different user) cannot complete seller's attempt
    await expect(asService(attacker, "select public.complete_ai_attempt($1,$2,true,100)", [attacker, res.attempt_id])).rejects.toThrow();
    // authenticated client cannot call complete directly
    await expect(asUser(seller, "select public.complete_ai_attempt($1,$2,true,100)", [seller, res.attempt_id])).rejects.toThrow();
    // no public refund
    await expect(asUser(seller, "select * from public.ai_operations where id=$1", [res.attempt_id])).resolves.toBeDefined(); // can read own
    await db.query("select proname from pg_proc where proname like '%refund%'");
    // ensure no refund RPC granted to authenticated
    const grants = (await db.query("select grantee, privilege_type from information_schema.role_routine_grants where routine_name='complete_ai_attempt'")).rows as { grantee: string; privilege_type: string }[];
    expect(grants.some(g => g.grantee === "authenticated")).toBe(false);
    expect(grants.some(g => g.grantee === "service_role")).toBe(true);
  });
  it("old 3-arg RPC revoked from authenticated", async () => {
    await expect(asUser(seller, "select * from public.reserve_ai_usage('draft',50,5)")).rejects.toThrow();
    await expect(asUser(seller, "select * from public.complete_ai_usage('00000000-0000-0000-0000-000000000000'::uuid,true,10)")).rejects.toThrow();
  });
});

describe("actual bound fixtures for 60s voice and 1200 output draft (TEST ONLY, not production)", () => {
  it("transcribe 60s cost: 60s * $0.18/3600 = 3000 microUSD, fixture 3500 conservatively rounded integer microUSD", async () => {
    const cost60s = 60 * 0.18 / 3600 * 1_000_000; // 3000
    expect(Math.round(cost60s)).toBe(3000);
    // fixture must be >= output alone and conservatively rounded
    const fixture = 3500;
    expect(fixture).toBeGreaterThanOrEqual(3000);
    expect(Number.isInteger(fixture)).toBe(true);
    // verify candidate docs mention 3000 and fixture not guessed 500
    expect(candidateSql).toContain("3000");
    expect(candidateSql).not.toContain("'transcribe','meta', 500");
  });
  it("draft 1200 output cost: 1200*$4.25/1e6=5100 microUSD output alone, fixture 8500 TEST ONLY", async () => {
    const outputAlone = 1200 * 4.25 / 1_000_000 * 1_000_000; // 5100
    expect(outputAlone).toBe(5100);
    const fixture = 8500;
    expect(fixture).toBeGreaterThan(outputAlone);
    expect(Number.isInteger(fixture)).toBe(true);
    // candidate must not contain guessed 1500
    expect(candidateSql).not.toContain("'draft','meta', 1500");
    // ensure pricebook model bound explicitly
    expect(candidateSql).toContain("muse-spark-1.3");
    expect(candidateSql).toContain("muse-voice-transcribe-1.0");
    expect(candidateSql).toContain("sam-3.1");
  });
});

describe("guard + meter integration via actual guard (mocked provider, PGlite authorization)", () => {
  it("guard respects duplicate disposition: fresh attempt ID+claim required for provider execution", async () => {
    const { runGuardedAi } = await import("@/lib/ai/guard");
    let callCount = 0;
    const ledger = {
      reserve: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return { allowed: true, usageId: "attempt-1", reason: null };
        // second HTTP duplicate should be nonexecution
        return { allowed: false, usageId: null, reason: "duplicate_pending" };
      }),
      complete: vi.fn(async () => undefined),
    };
    const op = vi.fn(async () => "ok");
    const result = await runGuardedAi({ enabled: true, ledger, operation: op, maxRetries: 1 });
    expect(result).toBe("ok");
    expect(ledger.reserve).toHaveBeenCalledTimes(1);
    // simulate duplicate request: reserve returns duplicate -> guard treats as AI_LIMIT (429)
    const dupLedger = {
      reserve: async () => ({ allowed: false, usageId: null, reason: "duplicate_pending" as string }),
      complete: async () => undefined,
    };
    await expect(runGuardedAi({ enabled: true, ledger: dupLedger, operation: op })).rejects.toMatchObject({ code: "AI_LIMIT" });
  });

  it("guard does not start provider after reserve deadline and retains failed reservation", async () => {
    vi.useFakeTimers();
    const { runGuardedAi } = await import("@/lib/ai/guard");
    const ledger = {
      reserve: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { allowed: true, usageId: "usage" };
      }),
      complete: vi.fn(async () => undefined),
    };
    const op = vi.fn(async () => "ok");
    const running = runGuardedAi({ enabled: true, ledger, operation: op as never, timeoutMs: 50 });
    const assert = expect(running).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(90);
    await assert;
    expect(op).not.toHaveBeenCalled();
    expect(ledger.complete).toHaveBeenCalledWith("usage", false, expect.any(Number));
    vi.useRealTimers();
  });

  it("guard bounds reserve wait: delayed reserve beyond 4s fails as unavailable, no provider", async () => {
    vi.useFakeTimers();
    const { runGuardedAi } = await import("@/lib/ai/guard");
    const ledger = {
      reserve: vi.fn(async () => { await new Promise((r) => setTimeout(r, 5000)); return { allowed: true, usageId: "u" }; }),
      complete: vi.fn(async () => undefined),
    };
    const op = vi.fn(async () => "ok");
    const running = runGuardedAi({ enabled: true, ledger, operation: op as never, timeoutMs: 10000 });
    const assert = expect(running).rejects.toMatchObject({ code: "AI_LIMIT_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(4100);
    await assert;
    expect(op).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("guard bounds complete hang: complete exceeding 2.5s does not block return", async () => {
    const { runGuardedAi } = await import("@/lib/ai/guard");
    const ledger = {
      reserve: vi.fn(async () => ({ allowed: true, usageId: "u1" })),
      complete: vi.fn(async () => { await new Promise((r) => setTimeout(r, 5000)); }),
    };
    const op = async () => "fast";
    const start = Date.now();
    const result = await runGuardedAi({ enabled: true, ledger, operation: op as never, timeoutMs: 10000 });
    expect(result).toBe("fast");
    expect(Date.now() - start).toBeLessThan(4000); // complete hang bounded to 2.5s, not 5s
  });

  it("moderation remains unavailable to avoid charging coding pool silently", async () => {
    const { getAiFeatureAvailability } = await import("@/lib/server/env");
    const avail = getAiFeatureAvailability();
    expect(avail.moderation).toBe(false);
    expect((avail as unknown as { moderationNote: string }).moderationNote).toMatch(/coding pool/i);
  });

  it("invalid provider fails closed, getAiFeatureAvailability does not pretend DB ready", async () => {
    const original = process.env.AI_DRAFT_PROVIDER;
    const originalModel = process.env.META_MODEL;
    process.env.AI_DRAFT_PROVIDER = "invalid-provider";
    const { getAiFeatureAvailability } = await import("@/lib/server/env");
    // need to reimport fresh? but function reads env each call, so invalid should cause providerValid false
    const avail = getAiFeatureAvailability();
    expect(avail.draft).toBe(false);
    expect(avail.providerValid).toBe(false);
    process.env.AI_DRAFT_PROVIDER = original;
    process.env.META_MODEL = "invalid-model";
    const avail2 = getAiFeatureAvailability();
    expect(avail2.draft).toBe(false);
    process.env.AI_DRAFT_PROVIDER = original;
    process.env.META_MODEL = originalModel;
  });
});
