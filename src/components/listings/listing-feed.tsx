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
  return <section className="space-y-5" aria-label="Marketplace listings">
    {error && <div role="alert" className="rounded-2xl border border-[#4a102f] bg-[#220815] p-5"><p className="text-sm leading-5 text-[#f5c6d8]">{error}</p><Button variant="secondary" size="sm" className="mt-3" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>}
    {!result && !error && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5" aria-label="Loading listings">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-[4/3] rounded-2xl" />)}</div>}
    {result?.mode === "demo" && <p className="text-xs leading-5 text-[#9AA4B8]">Sample listings and original illustrations. These items are for exploring the app and are not for sale.</p>}
    {result && <div className="flex items-baseline justify-between gap-4 border-b border-[#021640] pb-3"><h2 className="text-[15px] font-semibold tracking-tight text-[#F5F5F7]">{query ? "Your finds" : "Around campus"}</h2><p className="text-xs font-medium text-[#9AA4B8]">{result.meta?.total ?? result.data.length} available</p></div>}
    {result && result.data.length === 0 && <div className="rounded-2xl border border-dashed border-[#021640] bg-[#01071d] px-6 py-12 text-center md:py-16"><h3 className="text-[15px] font-semibold text-[#F5F5F7]">Nothing here just yet.</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#9AA4B8]">Try a broader search, or clear filters to see everything around campus.</p><Button asChild variant="secondary" className="mt-5"><Link href="/">Clear filters</Link></Button></div>}
    {result && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">{result.data.map((listing) => <ListingCard key={listing.id} listing={listing} />)}</div>}
    {result?.meta?.next_cursor != null && <div className="flex justify-center pt-2"><Button variant="secondary" disabled={loadingMore} onClick={more}>{loadingMore ? "Loading…" : "Load more finds"}</Button></div>}
  </section>;
}
