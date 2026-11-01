import type { ApiResponse, ApiError, Listing, Category, ThreadSummary, ThreadDetail, SessionInfo } from "@/lib/marketplace";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T> & { ok: true } | { ok: false; error: ApiError["error"]; status: number }> {
  try {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as ApiError).error ?? { code: String(res.status), message: json?.message ?? res.statusText };
    return { ok: false, error: err, status: res.status };
  }
  return { ok: true, ...(json as ApiResponse<T>) };
  } catch {
    return { ok: false, error: { code: "CONNECTION", message: "Check your connection and try again." }, status: 0 };
  }
}

export async function fetchListings(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return apiFetch<Listing[]>(`/api/listings${qs ? `?${qs}` : ""}`);
}

export async function fetchListing(id: string) {
  return apiFetch<Listing>(`/api/listings/${id}`);
}

export async function fetchCategories() {
  return apiFetch<Category[]>(`/api/categories`);
}

export async function fetchSession(): Promise<SessionInfo | null> {
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as ApiResponse<SessionInfo> | SessionInfo;
    // normalize both {data: SessionInfo} and raw SessionInfo
    if (json && typeof json === "object" && "data" in json) return (json as ApiResponse<SessionInfo>).data;
    return json as SessionInfo;
  } catch { return null; }
}

export async function fetchThreads() {
  return apiFetch<ThreadSummary[]>(`/api/threads`);
}
export async function fetchThread(id: string) {
  return apiFetch<ThreadDetail>(`/api/threads/${id}`);
}
export async function fetchMyListings(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<Listing[]>(`/api/my-listings${qs}`);
}
