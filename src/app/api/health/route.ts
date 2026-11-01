import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/supabase";
import { getAppMode, getAiEnabled, isAuthConfigured } from "@/lib/server/env";
import type { AppMode } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = getAppMode();
  const ai_enabled = getAiEnabled();

  const base: Record<string, unknown> = {
    status: "ok",
    mode,
    auth_configured: isAuthConfigured(),
    ai_enabled,
    timestamp: new Date().toISOString(),
  };

  // In demo mode, always healthy without DB
  if (mode === "demo") {
    const res = NextResponse.json({ data: base, mode: mode as AppMode });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  // Live / setup: check DB readiness
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const body = { data: { ...base, status: "unavailable", reason: "missing_config" }, mode: "setup" as AppMode };
    const res = NextResponse.json(body, { status: 503 });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  // Check categories table exists and listings schema reachable
  // Use a lightweight query
  try {
    const { error: catErr } = await supabase.from("categories").select("id").limit(1);
    if (catErr) {
      // If table missing or other schema error, report unavailable
      const code = (catErr as { code?: string }).code;
      const isSchemaMissing = code === "42P01" || catErr.message?.includes("does not exist") || catErr.message?.includes("schema");
      const reason = isSchemaMissing ? "schema_unavailable" : "db_error";
      const body = { data: { ...base, status: "unavailable", reason, db_code: code }, mode: "setup" as AppMode };
      const res = NextResponse.json(body, { status: 503 });
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    }

    const { error: listErr } = await supabase.from("listings").select("id").limit(1);
    if (listErr) {
      const code = (listErr as { code?: string }).code;
      const isSchemaMissing = code === "42P01" || listErr.message?.includes("does not exist");
      const reason = isSchemaMissing ? "schema_unavailable" : "db_error";
      const body = { data: { ...base, status: "unavailable", reason }, mode: "setup" as AppMode };
      const res = NextResponse.json(body, { status: 503 });
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    }

    // Healthy
    const res = NextResponse.json({ data: { ...base, status: "ok" }, mode: mode as AppMode });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    console.error("[health] check failed:", e);
    const body = { data: { ...base, status: "unavailable", reason: "exception" }, mode: "setup" as AppMode };
    const res = NextResponse.json(body, { status: 503 });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
}
