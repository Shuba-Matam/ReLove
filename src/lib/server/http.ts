import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAppMode } from "./env";
import type { AppMode } from "@/lib/marketplace";

export class ApiProblem extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = "ApiProblem";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function flattenZod(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (!fields[path]) fields[path] = [];
    fields[path].push(issue.message);
  }
  return fields;
}

export function json<T>(data: T, init?: number | { status?: number; mode?: AppMode; meta?: { next_cursor?: number | null; total?: number } }, meta?: { next_cursor?: number | null; total?: number }): NextResponse {
  let status = 200;
  let mode: AppMode | undefined;
  let metaObj: { next_cursor?: number | null; total?: number } | undefined;

  if (typeof init === "number") {
    status = init;
    metaObj = meta;
  } else if (init && typeof init === "object") {
    if (typeof init.status === "number") status = init.status;
    mode = init.mode;
    metaObj = init.meta ?? meta;
  }

  const effectiveMode = mode ?? getAppMode();
  const body: Record<string, unknown> = { data, mode: effectiveMode };
  if (metaObj !== undefined) body.meta = metaObj;

  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export function errorJson(problem: ApiProblem): NextResponse {
  const body: Record<string, unknown> = { error: { code: problem.code, message: problem.message } };
  if (problem.fields) (body.error as Record<string, unknown>).fields = problem.fields;
  const res = NextResponse.json(body, { status: problem.status });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function readJson<T>(request: Request | NextRequest, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const type = request.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("application/json")) throw new ApiProblem(415,"content_type","Send JSON for this request.");
    if (Number(request.headers.get("content-length") || 0) > 32768) throw new ApiProblem(413,"body_size","Request is too large.");
    const body = await readBodyLimited(request, 32768);
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem(400, "invalid_json", "Invalid JSON body.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiProblem(400, "validation_error", "Invalid input.", flattenZod(parsed.error));
  }
  return parsed.data;
}

export function assertSameOrigin(request: Request | NextRequest): void {
 if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
 const fetchSite = request.headers.get("sec-fetch-site");
 if (fetchSite === "cross-site") throw new ApiProblem(403, "csrf_rejected", "Cross-origin request rejected.");
 const source = request.headers.get("origin") || request.headers.get("referer");
 if (!source) throw new ApiProblem(403,"csrf_rejected","Missing Origin or Referer for mutation.");
 try { if(new URL(source).origin !== getRequestOrigin(request)) throw new Error("origin"); }
 catch { throw new ApiProblem(403,"csrf_rejected","Cross-origin request rejected."); }
}

export function withApi<T extends Request | NextRequest = NextRequest>(
  handler: (request: T, context?: unknown) => Promise<NextResponse>
): (request: T, context?: unknown) => Promise<NextResponse> {
  return async (request: T, context?: unknown) => {
    try {
      assertSameOrigin(request);
      const res = await handler(request, context);
      // Ensure no-store if not already set
      if (!res.headers.get("Cache-Control")) {
        res.headers.set("Cache-Control", "private, no-store");
      } else if (!res.headers.get("Cache-Control")?.includes("no-store")) {
        res.headers.set("Cache-Control", "private, no-store");
      }
      return res;
    } catch (err) {
      if (err instanceof ApiProblem) {
        return errorJson(err);
      }
      if (err instanceof z.ZodError) {
        const fields = flattenZod(err);
        const problem = new ApiProblem(400, "validation_error", "Invalid input.", fields);
        return errorJson(problem);
      }
      // Non-leaking internal error
      console.error("[api] unexpected error:", err);
      const problem = new ApiProblem(500, "internal_error", "An unexpected error occurred.");
      return errorJson(problem);
    }
  };
}

export function sanitizeNextPath(next: string | null | undefined): string {
 if (!next || next.length > 500 || !next.startsWith("/") || next.startsWith("//")) return "/";
 try {
  const decoded = decodeURIComponent(next);
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//") || decoded.includes("://")) return "/";
  const parsed = new URL(next,"https://relove.invalid");
  if(parsed.origin !== "https://relove.invalid" || parsed.pathname.startsWith("/auth/")) return "/";
  return next;
 } catch { return "/"; }
}

export function getRequestOrigin(request: NextRequest | Request): string {
 const url = new URL(request.url);
 // On Vercel the proxy is trusted only for protocol, never a client supplied host.
 const protocol = process.env.VERCEL === "1" && request.headers.get("x-forwarded-proto") === "https" ? "https:" : url.protocol;
 return protocol + "//" + url.host;
}

export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
 if(Number(request.headers.get("content-length") || 0) > maxBytes) throw new ApiProblem(413,"body_size","Request is too large.");
 if(!request.body) return new Uint8Array();
 const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
 try { while(true) { const { done, value } = await reader.read(); if(done) break; total += value.byteLength; if(total > maxBytes) throw new ApiProblem(413,"body_size","Request is too large."); chunks.push(value); } }
 finally { await reader.cancel().catch(() => undefined); }
 const result = new Uint8Array(total); let offset = 0; for(const chunk of chunks) { result.set(chunk,offset); offset += chunk.byteLength; } return result;
}
export async function readFormLimited(request: Request, maxBytes: number): Promise<FormData> {
 const contentType = request.headers.get("content-type") || "";
 if(!contentType.startsWith("multipart/form-data;")) throw new ApiProblem(415,"content_type","Send an uploaded file.");
 const bytes = await readBodyLimited(request,maxBytes);
 try { return await new Response(new Blob([bytes as BlobPart]),{ headers: { "content-type":contentType } }).formData(); }
 catch { throw new ApiProblem(400,"invalid_form","The uploaded file could not be read."); }
}
