import { describe, it, beforeAll, beforeEach, afterAll, vi, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

vi.mock("@/lib/server/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/ai/meter", async () => {
  const actual = (await vi.importActual("@/lib/ai/meter")) as Record<string, unknown>;
  return {
    ...(actual as object),
    createMeteringClient: vi.fn(),
  };
});
vi.mock("@/lib/ai/cutout", async () => {
  const actual = (await vi.importActual("@/lib/ai/cutout")) as Record<string, unknown>;
  return {
    ...(actual as object),
    makeCutout: vi.fn(),
  };
});

let db: PGlite;
const seller = "11111111-1111-4111-8111-111111111111";
const attacker = "33333333-3333-4333-8333-333333333333";
const storageMap = new Map<string, { buffer: Buffer; type: string }>();

function hash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

async function asService(sql: string, params: unknown[] = []) {
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  try {
    return await db.query(sql, params as never[]);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("select set_config('request.jwt.claim.role','',false)");
  }
}
async function asUserWithId(userId: string, sql: string, params: unknown[] = []) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  try {
    return await db.query(sql, params as never[]);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

function makeRequest(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://localhost:3000",
    referer: "http://localhost:3000/",
    ...extraHeaders,
  });
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function createMockSupabase(userId: string) {
  const mockFrom = (table: string) => {
    const state: {
      table: string;
      operation: "select" | "update" | null;
      selectCols: string | null;
      updatePayload: Record<string, unknown> | null;
      filters: Array<{ col: string; val: unknown }>;
      orCondition: string | null;
    } = {
      table,
      operation: null,
      selectCols: null,
      updatePayload: null,
      filters: [],
      orCondition: null,
    };
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        state.selectCols = cols;
        if (!state.operation) state.operation = "select";
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        state.operation = "update";
        state.updatePayload = payload;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        state.filters.push({ col, val });
        return builder;
      },
      or: (cond: string) => {
        state.orCondition = cond;
        return builder;
      },
      maybeSingle: async () => {
        try {
          if (state.table === "listings") {
            if (state.operation === "select") {
              let sql = "select * from public.listings where 1=1";
              const params: unknown[] = [];
              let idx = 1;
              for (const f of state.filters) {
                sql += ` and ${f.col}=$${idx}`;
                params.push(f.val);
                idx++;
              }
              const res = await asUserWithId(userId, sql, params);
              const row = res.rows[0] as Record<string, unknown> | undefined;
              if (!row) return { data: null, error: null };
              return { data: row, error: null };
            }
            if (state.operation === "update" && state.updatePayload) {
              const setKeys = Object.keys(state.updatePayload);
              const setVals = setKeys.map((k) => state.updatePayload![k]);
              let sql = `update public.listings set `;
              sql += setKeys.map((k, i) => `${k}=$${i + 1}`).join(", ");
              sql += " where 1=1";
              const params: unknown[] = [...setVals];
              let idx = setVals.length + 1;
              for (const f of state.filters) {
                sql += ` and ${f.col}=$${idx}`;
                params.push(f.val);
                idx++;
              }
              if (state.orCondition) {
                const parts = state.orCondition.split(",");
                const orSql = parts
                  .map((p) => {
                    const [col, op, ...rest] = p.split(".");
                    const val = rest.join(".");
                    if (op === "neq") return `${col} <> '${val.replace(/'/g, "''")}'`;
                    if (op === "lt") return `${col} < '${val.replace(/'/g, "''")}'`;
                    if (op === "gt") return `${col} > '${val.replace(/'/g, "''")}'`;
                    return `${col} ${op} '${val}'`;
                  })
                  .join(" or ");
                sql += ` and (${orSql})`;
              }
              if (state.selectCols) sql += " returning *";
              const res = await asUserWithId(userId, sql, params);
              if (state.selectCols) {
                const row = res.rows[0] as Record<string, unknown> | undefined;
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              }
              return { data: null, error: null };
            }
          }
          return { data: null, error: { message: "unsupported" } };
        } catch (e) {
          return { data: null, error: e as { message: string } };
        }
      },
      then: (onFulfilled: unknown, onRejected: unknown) => {
        const p = (builder as { maybeSingle: () => Promise<{ data: unknown; error: unknown }> }).maybeSingle();
        return (p as Promise<unknown>).then(onFulfilled as never, onRejected as never);
      },
    };
    return builder;
  };

  return {
    from: (table: string) => mockFrom(table),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const entry = storageMap.get(path);
          if (!entry) return { data: null, error: { message: "not found" } };
          const blob = {
            size: entry.buffer.length,
            type: entry.type,
            arrayBuffer: async () => entry.buffer.buffer.slice(entry.buffer.byteOffset, entry.buffer.byteOffset + entry.buffer.byteLength),
          };
          return { data: blob as unknown as Blob, error: null };
        },
        upload: async (path: string, data: Buffer | Uint8Array, opts: { contentType?: string; upsert?: boolean }) => {
          if (storageMap.has(path) && !opts?.upsert) return { data: null, error: { message: "exists" } };
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          storageMap.set(path, { buffer: buf, type: opts?.contentType ?? "image/jpeg" });
          try {
            await asUserWithId(userId, "insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing", [bucket, path]);
          } catch {}
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            storageMap.delete(p);
            try {
              await asUserWithId(userId, "delete from storage.objects where bucket_id=$1 and name=$2", [bucket, p]);
            } catch {}
          }
          return { data: {}, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
        list: async (path: string, options: { search: string }) => ({
          data: [...storageMap.keys()].filter((name) => name.startsWith(`${path}/`) && name.split("/")[1] === options.search).map((name) => ({ name: name.split("/")[1] })),
          error: null,
        }),
      }),
    },
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: `${userId}@test` } }, error: null }),
    },
    rpc: async (fn: string, params: unknown) => {
      const p = params as Record<string, unknown>;
      if (fn === "reserve_ai_usage" || fn === "complete_ai_usage") {
        const res = await asUserWithId(userId, `select * from public.${fn}(${Object.keys(p).map((_, i) => `$${i + 1}`).join(",")})`, Object.values(p));
        return { data: res.rows, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  };
}

function createMockMeteringClient() {
  return {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === "ai_pricebook") {
              const res = await asService(`select ${cols} from public.ai_pricebook where ${col}=$1`, [val]);
              const row = res.rows[0] as Record<string, unknown> | undefined;
              if (!row) return { data: null, error: null };
              return { data: row, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn: string, params: Record<string, unknown>) => {
      const keys = Object.keys(params);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const vals = Object.values(params);
      try {
        const res = await asService(`select * from public.${fn}(${placeholders})`, vals);
        return { data: res.rows, error: null };
      } catch (e) {
        return { data: null, error: e as { message: string } };
      }
    },
  };
}

async function seedImage(userId: string, imagePath: string, width = 100, height = 100) {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
  storageMap.set(imagePath, { buffer: buf, type: "image/jpeg" });
  await asUserWithId(userId, "insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing", ["listing-images", imagePath]);
  return buf;
}

async function createListing(listingId: string, sellerId: string, imagePath: string, title = "Desk chair") {
  const imageUrl = `https://example.supabase.co/storage/v1/object/public/listing-images/${imagePath}`;
  await asService("insert into public.listings(id,seller_id,category_id,title,description,price_inr,condition,hostel_block,image_path,image_url) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing", [
    listingId,
    sellerId,
    "00000000-0000-4000-8000-000000000003",
    title,
    "A chair for studying long enough description",
    1000,
    "good",
    "Block A",
    imagePath,
    imageUrl,
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create schema storage; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.role() returns text language sql stable as $$ select current_user::text $$; grant usage on schema auth,storage to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text); alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated; grant select on storage.objects to anon; create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;`);
  await db.exec(await readFile("supabase/migrations-draft/001_initial.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations-draft/002_ai.sql", "utf8"));
  await db.exec(await readFile("docs/drafts/003_ai_budget_hardening.sql", "utf8"));
  await db.exec("grant service_role to postgres");
  await db.exec("grant all on public.listings to service_role");
  await db.exec("grant all on storage.objects to service_role");
  await db.exec("create policy listings_service_all on public.listings for all to service_role using (true) with check (true)");
  await db.exec("create policy storage_service_all on storage.objects for all to service_role using (true) with check (true)");
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}'::jsonb) on conflict (id) do nothing", [seller, "seller@test"]);
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}'::jsonb) on conflict (id) do nothing", [attacker, "attacker@test"]);
  await db.query("insert into public.profiles(id,display_name) values($1,$2) on conflict (id) do nothing", [seller, "Seller"]);
  await db.query("insert into public.profiles(id,display_name) values($1,$2) on conflict (id) do nothing", [attacker, "Attacker"]);
  await db.query("insert into public.categories(id,slug,name,icon) values('00000000-0000-4000-8000-000000000003','furniture','Room essentials','Armchair') on conflict (id) do nothing");
  process.env.AI_ENABLED = "true";
  process.env.AI_DAILY_LIMIT = "100";
  process.env.AI_USER_DAILY_LIMIT = "100";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test_service_key";
  process.env.META_API_KEY = "meta_test_key";
  process.env.AI_DRAFT_PROVIDER = "meta";
  process.env.META_MODEL = "muse-spark-1.3";
  process.env.APP_MODE = "live";
  process.env.BASETEN_API_KEY = "baseten_test_key";
  process.env.AI_MAX_RETRIES = "1";
}, 60000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  storageMap.clear();
  await db.exec("update public.ai_budget set enabled=true, daily_limit=100, per_user_limit=100, meta_micro_usd_cap=1000000, baseten_micro_usd_cap=1000000, meta_micro_usd_used=0, baseten_micro_usd_used=0, meta_reserve_micro_usd=0, baseten_reserve_micro_usd=0 where id=true");
  await db.exec("update public.ai_settings set enabled=true, daily_limit=100, per_user_limit=100");
  await db.exec("delete from public.ai_attempts; delete from public.ai_operations; delete from public.ai_usage; delete from public.ai_pricebook; delete from public.listings; delete from storage.objects");
  await asService("insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled,input_max_chars,output_max_tokens,max_duration_sec,version) values('draft','meta','muse-spark-1.3',8500,true,8000,1200,null,1)");
  await asService("insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled,max_duration_sec,version) values('transcribe','meta','muse-voice-transcribe-1.0',3500,true,60,1)");
  await asService("insert into public.ai_pricebook(feature,provider,model,max_cost_micro_usd,enabled,version) values('cutout','meta','sam-3.1',4000,true,1)");
  vi.restoreAllMocks();
});

describe("actual production guard+meter+cache via PGlite service_role (no duplicate harness)", () => {
  it("sequential duplicate success returns same draft via DB cache, provider spy count1", async () => {
    const { runMeteredGuarded } = await import("@/lib/ai/guard");
    const providerSpy = vi.fn(async () => ({ title: "Desk chair", description: "A chair", category_slug: "furniture", tags: ["chair"], condition_hint: null, brand: null, edition: null }));
    const makeLedger = (idem: string, src: string) => ({
      reserve: async () => {
        const res = await asService("select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, idem, src]);
        const row = res.rows[0] as Record<string, unknown>;
        return { operationId: row.operation_id as string | null, attemptId: row.attempt_id as string | null, allowed: row.allowed as boolean, disposition: row.disposition as "executed" | "duplicate_done" | "duplicate_pending" | "rejected", reason: row.reason as string | null, cachedResult: row.cached_result as unknown };
      },
      complete: async (attemptId: string, ok: boolean, ms: number, result?: unknown) => {
        await asService("select public.complete_ai_attempt($1,$2,$3,$4,$5)", [seller, attemptId, ok, ms, result ? JSON.stringify(result) : null]);
      },
    });
    const idem = "dup-" + hash("dup1").slice(0, 16);
    const src = hash("source1");
    const ledger1 = makeLedger(idem, src);
    const r1 = await runMeteredGuarded({ ledger: ledger1, operation: providerSpy, validateCached: (c) => c as typeof providerSpy extends () => Promise<infer T> ? T : never, maxRetries: 0 });
    expect(r1.status).toBe("fresh");
    expect(providerSpy).toHaveBeenCalledTimes(1);
    providerSpy.mockClear();
    const ledger2 = makeLedger(idem, src);
    const r2 = await runMeteredGuarded({ ledger: ledger2, operation: providerSpy, maxRetries: 0 });
    expect(r2.status).toBe("duplicate_done");
    expect(providerSpy).toHaveBeenCalledTimes(0);
    const op = await asService("select result from public.ai_operations where idempotency_key=$1", [idem]);
    expect(((op.rows[0] as Record<string, unknown>).result as Record<string, unknown>).title).toBe("Desk chair");
  });

  it("pending =>409 with no provider calls (second pending duplicate not executing provider)", async () => {
    const { runMeteredGuarded } = await import("@/lib/ai/guard");
    const providerSpy = vi.fn(async () => new Promise(() => {}));
    const makeLedger = (idem: string, src: string) => ({
      reserve: async () => {
        const res = await asService("select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, idem, src]);
        const row = res.rows[0] as Record<string, unknown>;
        return { operationId: row.operation_id as string | null, attemptId: row.attempt_id as string | null, allowed: row.allowed as boolean, disposition: row.disposition as "executed" | "duplicate_done" | "duplicate_pending" | "rejected", reason: row.reason as string | null, cachedResult: row.cached_result as unknown };
      },
      complete: async () => {},
    });
    const idem = "pending-" + hash("pending1").slice(0, 16);
    const src = hash("pendingsrc");
    const ledger1 = makeLedger(idem, src);
    const p1 = runMeteredGuarded({ ledger: ledger1, operation: providerSpy, maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(providerSpy).toHaveBeenCalledTimes(1);
    providerSpy.mockClear();
    const ledger2 = makeLedger(idem, src);
    const r2 = await runMeteredGuarded({ ledger: ledger2, operation: providerSpy, maxRetries: 0 });
    expect(r2.status).toBe("duplicate_pending");
    expect(providerSpy).toHaveBeenCalledTimes(0);
    p1.catch(() => undefined);
    const op = await asService("select id from public.ai_operations where idempotency_key=$1", [idem]);
    if ((op.rows[0] as Record<string, unknown>)) {
      const att = await asService("select id from public.ai_attempts where operation_id=$1", [(op.rows[0] as Record<string, unknown>).id as string]);
      if ((att.rows[0] as Record<string, unknown>)) await asService("select public.complete_ai_attempt($1,$2,false,100)", [seller, (att.rows[0] as Record<string, unknown>).id as string]);
    }
  });

  it("invalid meter response (malformed fresh allowed without attemptId) fails closed, 0 provider", async () => {
    const { runMeteredGuarded } = await import("@/lib/ai/guard");
    const providerSpy = vi.fn(async () => "ok");
    const ledger = {
      reserve: async () => ({ operationId: seller, attemptId: null, allowed: true, disposition: "executed" as const, reason: null, cachedResult: null }),
      complete: async () => {},
    };
    await expect(runMeteredGuarded({ ledger, operation: providerSpy, maxRetries: 0 })).rejects.toMatchObject({ code: "AI_LIMIT_UNAVAILABLE" });
    expect(providerSpy).toHaveBeenCalledTimes(0);
  });

  it("changed image distinct identity: different image hash creates new operation", async () => {
    const idemSame = "img-same-" + hash("same").slice(0, 8);
    const src1 = hash("image-hash-1");
    const src2 = hash("image-hash-2");
    const makeLedger = (src: string) => ({
      reserve: async () => {
        const res = await asService("select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, idemSame, src]);
        const row = res.rows[0] as Record<string, unknown>;
        return { operationId: row.operation_id as string | null, attemptId: row.attempt_id as string | null, allowed: row.allowed as boolean, disposition: row.disposition as "rejected" | "executed" | "duplicate_done" | "duplicate_pending", reason: row.reason as string | null, cachedResult: row.cached_result as unknown };
      },
      complete: async (attemptId: string, ok: boolean) => {
        await asService("select public.complete_ai_attempt($1,$2,$3,100)", [seller, attemptId, ok]);
      },
    });
    const ledger1 = makeLedger(src1);
    const res1 = await (await import("@/lib/ai/guard")).runMeteredGuarded({ ledger: ledger1, operation: async () => "ok1", maxRetries: 0 });
    expect(res1.status).toBe("fresh");
    const ledger2 = makeLedger(src2);
    const res2 = (await (await import("@/lib/ai/guard")).runMeteredGuarded({ ledger: ledger2, operation: async () => "ok2", maxRetries: 0 }).catch((e: unknown) => e)) as { code: string; status: number };
    expect(res2.code).toBe("AI_LIMIT");
    expect(res2.status).toBe(429);
    const idemDiff = "img-diff-" + hash("diff").slice(0, 8);
    const ledger3 = {
      reserve: async () => {
        const res = await asService("select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, idemDiff, src2]);
        const row = res.rows[0] as Record<string, unknown>;
        return { operationId: row.operation_id as string | null, attemptId: row.attempt_id as string | null, allowed: row.allowed as boolean, disposition: row.disposition as "executed" | "duplicate_done" | "duplicate_pending" | "rejected", reason: row.reason as string | null, cachedResult: row.cached_result as unknown };
      },
      complete: async () => {},
    };
    const res3 = await (await import("@/lib/ai/guard")).runMeteredGuarded({ ledger: ledger3, operation: async () => "ok3", maxRetries: 0 });
    expect(res3.status).toBe("fresh");
  });

  it("cutout upload failure not cached success: operation marked failed, duplicate not done", async () => {
    const idem = "cutout-fail-" + hash("cf1").slice(0, 8);
    const src = hash("cutout-src");
    const res1 = await asService("select * from public.reserve_ai_attempt($1,'cutout',$2,'meta','sam-3.1',$3,100,100)", [seller, idem, src]);
    expect((res1.rows[0] as Record<string, unknown>).allowed).toBe(true);
    await asService("select public.complete_ai_attempt($1,$2,false,100)", [seller, (res1.rows[0] as Record<string, unknown>).attempt_id as string]);
    const op = await asService("select status from public.ai_operations where idempotency_key=$1", [idem]);
    expect((op.rows[0] as Record<string, unknown>).status).toBe("failed");
    const res2 = await asService("select * from public.reserve_ai_attempt($1,'cutout',$2,'meta','sam-3.1',$3,100,100)", [seller, idem, src]);
    expect((res2.rows[0] as Record<string, unknown>).allowed).toBe(true);
    expect((res2.rows[0] as Record<string, unknown>).disposition).toBe("executed");
  });

  it("failed retry reserves separately/max3 enforced across requests", async () => {
    const idem = "retry-" + hash("retry1").slice(0, 8);
    const src = hash("retry-src");
    const makeLedger = () => ({
      reserve: async () => {
        const res = await asService("select * from public.reserve_ai_attempt($1,'draft',$2,'meta','muse-spark-1.3',$3,100,100)", [seller, idem, src]);
        const row = res.rows[0] as Record<string, unknown>;
        return { operationId: row.operation_id as string | null, attemptId: row.attempt_id as string | null, allowed: row.allowed as boolean, disposition: row.disposition as "executed" | "duplicate_done" | "duplicate_pending" | "rejected", reason: row.reason as string | null, cachedResult: row.cached_result as unknown };
      },
      complete: async (attemptId: string, ok: boolean) => {
        await asService("select public.complete_ai_attempt($1,$2,$3,100)", [seller, attemptId, ok]);
      },
    });
    const { runMeteredGuarded, AiFailure } = await import("@/lib/ai/guard");
    for (let i = 0; i < 3; i++) {
      const ledger = makeLedger();
      const res = (await runMeteredGuarded({ ledger, operation: async () => { throw new AiFailure("AI_PROVIDER", "fail", 503, true); }, maxRetries: 0 }).catch((e: unknown) => e)) as { code: string };
      expect(res.code).toBe("AI_PROVIDER");
    }
    const op = await asService("select attempt_count, status from public.ai_operations where idempotency_key=$1", [idem]);
    expect((op.rows[0] as Record<string, unknown>).attempt_count).toBe(3);
    const ledger4 = makeLedger();
    const r4 = (await runMeteredGuarded({ ledger: ledger4, operation: async () => "ok", maxRetries: 0 }).catch((e: unknown) => e)) as { code: string; status: number };
    expect(r4.code).toBe("AI_LIMIT");
    expect(r4.status).toBe(429);
  });

  it("old ledger bypass fails closed: authenticated cannot call reserve_ai_usage (returns unauthorized, not allowed)", async () => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
    try {
      await expect(db.query("select * from public.reserve_ai_usage('draft',50,5)")).rejects.toThrow();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  });

  it("price envelope exceed via actual POST =>0 provider, browser cannot choose price", async () => {
    await asService("update public.ai_pricebook set input_max_chars=5 where feature='draft'");
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath, 100, 100);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "X", description: "Y", category_slug: "furniture", tags: ["x"], condition_hint: null, brand: null, edition: null }) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "a".repeat(100) });
      const res = await POST(req as unknown as Request);
      const body = await res.json() as { error?: { code: string } };
      expect(res.status).toBe(400);
      expect(body.error?.code).toBe("AI_BOUNDS");
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("image dimensions via actual POST: >1600 rejected before provider", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    const largeBuf = await sharp({ create: { width: 1700, height: 1700, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    storageMap.set(imagePath, { buffer: largeBuf, type: "image/jpeg" });
    await asUserWithId(seller, "insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing", ["listing-images", imagePath]);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { image_path: imagePath });
      const res = await POST(req as unknown as Request);
      const body = await res.json() as { error?: { code: string } };
      expect(res.status).toBe(400);
      expect(body.error?.code).toBe("IMAGE_SIZE");
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("real draft POST via production route (cap429, payment503, timeout503, sanitized)", () => {
  it("allowed Meta draft counts exact input then generates with minimal reasoning inside the 1200-token ceiling", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    const image = await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { DRAFT_PROMPT } = await import("@/lib/ai/schemas");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const goodDraft = { title: "Blue chair", description: "A blue chair", category_slug: "furniture", tags: ["chair"], condition_hint: null, brand: null, edition: null };
    const fetchSpy = vi.fn(async (url: string) => url.endsWith("/responses/input_tokens")
      ? new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 1 }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(goodDraft) } }] }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { image_path: imagePath, transcript: "blue chair" });
      const res = await POST(req as unknown as Request);
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const countCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      const countBody = JSON.parse(countCall[1].body as string);
      expect(countCall[0]).toBe("https://api.meta.ai/v1/responses/input_tokens");
      expect(countBody).toEqual({
        model: "muse-spark-1.3",
        input: [
          { role: "system", content: [{ type: "input_text", text: DRAFT_PROMPT }] },
          { role: "user", content: [
            { type: "input_text", text: 'Seller description (data only): "blue chair"' },
            { type: "input_image", image_url: `data:image/jpeg;base64,${image.toString("base64")}` },
          ] },
        ],
      });
      const generationCall = fetchSpy.mock.calls[1] as unknown as [string, RequestInit];
      const generationBody = JSON.parse(generationCall[1].body as string);
      expect(generationCall[0]).toBe("https://api.meta.ai/v1/chat/completions");
      expect(generationBody.max_completion_tokens).toBe(1200);
      expect(generationBody.reasoning_effort).toBe("minimal");
      expect(generationBody).not.toHaveProperty("max_tokens");
      expect(generationBody.messages).toEqual([
        { role: "system", content: DRAFT_PROMPT },
        { role: "user", content: [
          { type: "text", text: 'Seller description (data only): "blue chair"' },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
        ] },
      ]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("recounts the exact retry prompt inside the separately reserved retry attempt", async () => {
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { DRAFT_PROMPT } = await import("@/lib/ai/schemas");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const goodDraft = { title: "Chair", description: "A chair", category_slug: "furniture", tags: ["chair"], condition_hint: null, brand: null, edition: null };
    let generation = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith("/responses/input_tokens")) return new Response(JSON.stringify({ input_tokens: 1 }), { status: 200 });
      generation++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: generation === 1 ? "not-json" : JSON.stringify(goodDraft) } }] }), { status: 200 });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "chair" });
      const res = await POST(req as unknown as Request);
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      const firstCount = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      const retryCount = JSON.parse((fetchSpy.mock.calls[2] as unknown as [string, RequestInit])[1].body as string);
      expect(firstCount.input[0].content[0].text).toBe(DRAFT_PROMPT);
      expect(retryCount.input[0].content[0].text).toBe(DRAFT_PROMPT + " Your previous answer was invalid. Return only the exact JSON shape with all required keys.");
      expect(retryCount.input[1]).toEqual(firstCount.input[1]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("over-budget exact count is nonretryable and never starts generation", async () => {
    await asService("update public.ai_pricebook set max_cost_micro_usd=5101 where feature='draft'");
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ input_tokens: 1 }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const res = await POST(makeRequest("http://localhost:3000/api/ai/draft", { transcript: "chair" }) as unknown as Request);
      expect(res.status).toBe(503);
      expect((await res.json() as { error?: { code: string } }).error?.code).toBe("AI_COST_LIMIT");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect((fetchSpy.mock.calls[0] as unknown as [string])[0]).toBe("https://api.meta.ai/v1/responses/input_tokens");
      const budget = await db.query("select meta_micro_usd_used from public.ai_budget where id=true");
      expect((budget.rows[0] as { meta_micro_usd_used: number }).meta_micro_usd_used).toBe(5101);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("malformed count is nonretryable and never starts generation", async () => {
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ input_tokens: -1 }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const res = await POST(makeRequest("http://localhost:3000/api/ai/draft", { transcript: "chair" }) as unknown as Request);
      expect(res.status).toBe(503);
      expect((await res.json() as { error?: { code: string } }).error?.code).toBe("AI_PREFLIGHT");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("count timeout shares the guard deadline and never starts generation", async () => {
    vi.useFakeTimers();
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const responsePromise = POST(makeRequest("http://localhost:3000/api/ai/draft", { transcript: "chair" }) as unknown as Request);
      await vi.advanceTimersByTimeAsync(20001);
      const res = await responsePromise;
      expect(res.status).toBe(503);
      expect((await res.json() as { error?: { code: string } }).error?.code).toBe("AI_TIMEOUT");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
      vi.useRealTimers();
    }
  });

  it("cap429 via actual POST when budget exhausted =>429 and 0 provider", async () => {
    await db.exec("update public.ai_budget set meta_micro_usd_cap=100, meta_micro_usd_used=95, meta_reserve_micro_usd=0 where id=true");
    await db.exec("update public.ai_budget set enabled=true where id=true");
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "X", description: "Y", category_slug: "furniture", tags: ["x"], condition_hint: null, brand: null, edition: null }) } }] }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "hello" });
      const res = await POST(req as unknown as Request);
      expect(res.status).toBe(429);
      const body = await res.json() as { error?: { code: string } };
      expect(body.error?.code).toBe("AI_LIMIT");
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("payment402 via actual POST =>503 no retry, provider called once", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify({ error: "payment" }), { status: 402, headers: { "content-type": "application/json" } });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "hello" });
      const res = await POST(req as unknown as Request);
      expect(res.status).toBe(503);
      const body = await res.json() as { error?: { code: string } };
      expect(body.error?.code).toBe("AI_PAYMENT");
      expect(callCount).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("timeout503 via actual POST when provider hangs =>503", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      return new Promise<Response>(() => {
        init.signal?.addEventListener("abort", () => {});
      });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "hello" });
      const resPromise = POST(req as unknown as Request);
      const res = await Promise.race([
        resPromise,
        new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("test timeout")), 25000)),
      ]) as Response;
      expect(res.status).toBe(503);
      const body = await res.json() as { error?: { code: string } };
      expect(["AI_TIMEOUT", "AI_UNAVAILABLE", "AI_LIMIT_UNAVAILABLE"]).toContain(body.error?.code);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  }, 30000);

  it("unknown provider error sanitized via actual POST =>503 generic", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async () => {
      return new Response(JSON.stringify({ secret: "super-secret-internal-xyz" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { transcript: "hello" });
      const res = await POST(req as unknown as Request);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toContain("super-secret");
      expect(text).not.toContain("secret");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("cached draft enforces null brand/edition/condition via parseAiDraft", async () => {
    const goodDraft = { title: "Chair", description: "A chair", category_slug: "furniture", tags: ["chair"], condition_hint: null, brand: null, edition: null };
    const badCached = { title: "Chair", description: "A chair", category_slug: "furniture", tags: ["chair"], condition_hint: "new", brand: "Acme", edition: "v2" };
    const { parseAiDraft } = await import("@/lib/ai/schemas");
    expect(parseAiDraft(JSON.stringify(goodDraft))).toMatchObject({ brand: null, edition: null, condition_hint: null });
    let validated: unknown = null;
    try {
      validated = parseAiDraft(JSON.stringify(badCached));
    } catch {}
    expect(validated).toMatchObject({ brand: null, edition: null, condition_hint: null });
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const fetchSpy = vi.fn(async (url: string) => url.endsWith("/responses/input_tokens")
      ? new Response(JSON.stringify({ object: "response.input_tokens", input_tokens: 1 }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(goodDraft) } }] }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const idem = "cache-test-" + hash("cache1").slice(0, 16);
      const req1 = makeRequest("http://localhost:3000/api/ai/draft", { image_path: imagePath }, { "x-idempotency-key": idem });
      const res1 = await POST(req1 as unknown as Request);
      expect(res1.status).toBe(200);
      const body1 = await res1.json() as { data: { draft: { brand: unknown; edition: unknown; condition_hint: unknown } } };
      expect(body1.data.draft.brand).toBeNull();
      expect(body1.data.draft.edition).toBeNull();
      expect(body1.data.draft.condition_hint).toBeNull();
      const req2 = makeRequest("http://localhost:3000/api/ai/draft", { image_path: imagePath }, { "x-idempotency-key": idem });
      const res2 = await POST(req2 as unknown as Request);
      expect(res2.status).toBe(200);
      const body2 = await res2.json() as { data: { draft: { brand: unknown } } };
      expect(body2.data.draft.brand).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("real prepublish cutout POST via production route", () => {
  it("generates before publication without inserting or mutating a listing", async () => {
    const listingId = randomUUID();
    const imagePathA = `${seller}/${randomUUID()}.jpg`;
    const bufA = await seedImage(seller, imagePathA, 100, 100);
    await createListing(listingId, seller, imagePathA, "Chair A");
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { makeCutout } = await import("@/lib/ai/cutout");
    const mockSupabase = createMockSupabase(seller);
    const origStorageFrom = mockSupabase.storage.from.bind(mockSupabase.storage);
    mockSupabase.storage.from = (bucket: string) => {
      const base = origStorageFrom(bucket);
      if (bucket === "listing-images") {
        return {
          ...base,
          download: async (path: string) => {
            if (path === imagePathA) {
              return { data: { size: bufA.length, type: "image/jpeg", arrayBuffer: async () => bufA.buffer.slice(bufA.byteOffset, bufA.byteOffset + bufA.byteLength) } as unknown as Blob, error: null };
            }
            return base.download(path);
          },
        };
      }
      return base;
    };
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(bufA);
    const { POST } = await import("@/app/api/ai/cutout/route");
    const req = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePathA, prompt: "chair" });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(200);
    const listing = await asService("select image_path, cutout_path, ai_status from public.listings where id=$1", [listingId]);
    const row = listing.rows[0] as Record<string, unknown>;
    expect(row.image_path).toBe(imagePathA);
    expect(row.cutout_path).toBeNull();
    const op = await asService("select listing_id,result from public.ai_operations where feature='cutout' order by created_at desc limit 1");
    expect((op.rows[0] as Record<string, unknown>).listing_id).toBeNull();
    expect((op.rows[0] as { result: { source_image_path: string } }).result.source_image_path).toBe(imagePathA);
  });

  it("upload failure not cached done: complete marked failed, next reserve fresh", async () => {
    const listingId = randomUUID();
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    await createListing(listingId, seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { makeCutout } = await import("@/lib/ai/cutout");
    const mockSupabase = createMockSupabase(seller);
    const origFromStorage = mockSupabase.storage.from.bind(mockSupabase.storage);
    mockSupabase.storage.from = (bucket: string) => {
      const base = origFromStorage(bucket);
      if (bucket === "listing-images") {
        return {
          ...base,
          upload: async () => ({ data: null, error: { message: "upload failed" } }),
        };
      }
      return base;
    };
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const processed = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(processed);
    const { POST } = await import("@/app/api/ai/cutout/route");
    const req = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "chair" });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(503);
    const op = await asService("select status from public.ai_operations where feature='cutout' order by created_at desc limit 1");
    expect((op.rows[0] as Record<string, unknown>).status).toBe("failed");
  });

  it("cached cutout returns BOTH cutout_path and cutout_url without provider", async () => {
    const listingId = randomUUID();
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    await createListing(listingId, seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { makeCutout } = await import("@/lib/ai/cutout");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    const processed = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(processed);
    const { POST } = await import("@/app/api/ai/cutout/route");
    const req1 = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "chair" });
    const res1 = await POST(req1 as unknown as Request);
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { data: { cutout_path: string; cutout_url: string; operation_id: string } };
    expect(body1.data.cutout_url.endsWith(body1.data.cutout_path)).toBe(true);
    expect(body1.data.operation_id).toBeTruthy();
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockClear();
    const req2 = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "chair" });
    const res2 = await POST(req2 as unknown as Request);
    expect(res2.status).toBe(200);
    expect((makeCutout as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(0);
    const body2 = await res2.json() as { data: { status: string } };
    expect(body2.data.status).toBe("done");
  });

  it("a different short object prompt is a distinct source-bound operation", async () => {
    const listingId = randomUUID();
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    const cutoutPath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const cutoutBuf = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
    storageMap.set(cutoutPath, { buffer: cutoutBuf, type: "image/jpeg" });
    await asUserWithId(seller, "insert into storage.objects(bucket_id,name) values($1,$2) on conflict do nothing", ["listing-images", cutoutPath]);
    await createListing(listingId, seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { makeCutout } = await import("@/lib/ai/cutout");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(cutoutBuf);
    const { POST } = await import("@/app/api/ai/cutout/route");
    const req1 = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "chair" });
    const req2 = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "armchair" });
    expect((await POST(req1 as unknown as Request)).status).toBe(200);
    expect((await POST(req2 as unknown as Request)).status).toBe(200);
    expect((makeCutout as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("stale pricebook fingerprint =>0 provider", async () => {
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    const realClient = createMockMeteringClient();
    let callCount = 0;
    const origRpc = realClient.rpc;
    realClient.rpc = async (fn: string, params: Record<string, unknown>) => {
      if (fn === "reserve_ai_attempt" && callCount === 0) {
        callCount++;
        await asService("update public.ai_pricebook set version=2, updated_at=now() where feature='draft'");
        return origRpc(fn, params);
      }
      return origRpc(fn, params);
    };
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(realClient);
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "X", description: "Y", category_slug: "furniture", tags: ["x"], condition_hint: null, brand: null, edition: null }) } }] }), { status: 200 }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { POST } = await import("@/app/api/ai/draft/route");
      const req = makeRequest("http://localhost:3000/api/ai/draft", { image_path: imagePath });
      const res = await POST(req as unknown as Request);
      expect([503, 429]).toContain(res.status);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("bounded timeout must reject, not only abort fetch", async () => {
    const listingId = randomUUID();
    const imagePath = `${seller}/${randomUUID()}.jpg`;
    await seedImage(seller, imagePath);
    await createListing(listingId, seller, imagePath);
    const { requireUser } = await import("@/lib/server/auth");
    const { createMeteringClient } = await import("@/lib/ai/meter");
    const { makeCutout } = await import("@/lib/ai/cutout");
    const mockSupabase = createMockSupabase(seller);
    (requireUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: seller, email: "seller@test" }, supabase: mockSupabase });
    (createMeteringClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(createMockMeteringClient());
    (makeCutout as unknown as ReturnType<typeof vi.fn>).mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      return new Promise<Buffer>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { POST } = await import("@/app/api/ai/cutout/route");
    const req = makeRequest("http://localhost:3000/api/ai/cutout", { image_path: imagePath, prompt: "chair" });
    const resPromise = POST(req as unknown as Request);
    const res = await Promise.race([
      resPromise,
      new Promise<Response>((_, r) => setTimeout(() => r(new Error("timeout test")), 25000)),
    ]) as Response;
    expect(res.status).toBe(503);
    const body = await res.json() as { error?: { code: string } };
    expect(body.error?.code).toBe("AI_TIMEOUT");
  }, 30000);
});
