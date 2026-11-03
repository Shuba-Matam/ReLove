"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ListingCard } from "./listing-card";
import { Button } from "@/components/ui/button";
import type { ApiResponse, Listing } from "@/lib/marketplace";
import { apiFetch } from "@/lib/client/api";
import { Skeleton } from "@/components/ui/skeleton";

export function ListingFeed() { const params = useSearchParams(); const query = params.toString(); return <Feed key={query} query={query} />; }
function Feed({ query }: { query: string }) {
  const [result, setResult] = useState<ApiResponse<Listing[]> | null>(null);
  const [error, setError] = useState(""); const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    apiFetch<Listing[]>(`/api/listings?${query}`).then((response) => {
      if (!active) return;
      if (response.ok) { setResult(response); setError(""); } else setError(response.error.message);
    });
    return () => { active = false; };
  }, [query, retry]);
  async function more() {
    if (result?.meta?.next_cursor == null) return;
    setLoadingMore(true);
    const params = new URLSearchParams(query); params.set("cursor", String(result.meta.next_cursor));
    const response = await apiFetch<Listing[]>(`/api/listings?${params}`);
    if (response.ok) { setResult({ ...response, data: [...result.data, ...response.data.filter((listing) => !result.data.some((existing) => existing.id === listing.id))] }); setError(""); }
    else setError(response.error.message);
    setLoadingMore(false);
  }
  return <section className="space-y-4" aria-label="Marketplace listings">
    {error && <div role="alert" className="rounded-xl bg-[#32171a] p-4 ring-1 ring-[#6b3434]"><p className="text-sm leading-5 text-[#f1c7bd]">{error}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
    {!result && !error && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" aria-label="Loading listings">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-[4/3] rounded-xl" />)}</div>}
    {result?.mode === "demo" && <p className="text-xs text-[#bba995]">Samples are for browsing only, not for sale.</p>}
    {result && <div className="flex items-baseline justify-between gap-4"><h2 className="text-[14px] font-medium tracking-tight text-[#f6ead8]">{query ? "Results" : "Latest on campus"}</h2><p className="text-xs text-[#bba995]">{result.meta?.total ?? result.data.length} items</p></div>}
    {result && result.data.length === 0 && <div className="py-12 text-center"><h3 className="text-sm font-medium text-[#f6ead8]">No matches</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#bba995]">Try fewer filters or clear search.</p><Button asChild variant="secondary" size="sm" className="mt-4"><Link href="/">Clear filters</Link></Button></div>}
    {result && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{result.data.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div>}
    {result?.meta?.next_cursor != null && <div className="flex justify-center pt-2"><Button variant="secondary" size="sm" disabled={loadingMore} onClick={more}>{loadingMore ? "Loading…" : "Load more"}</Button></div>}
  </section>;
}
