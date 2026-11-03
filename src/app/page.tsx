import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { CategoryChips } from "@/components/listings/category-chips";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="space-y-6 md:space-y-8">
      <section className="overflow-hidden rounded-[1.75rem] bg-[#241712] ring-1 ring-[#4a3025]/70">
        <div className="grid items-center gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1.15fr)_minmax(250px,0.85fr)] md:p-9 lg:gap-12">
          <div className="max-w-[52ch]">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#bba995]">Campus marketplace</p>
            <h1 className="mt-3 text-balance text-[2rem] font-semibold leading-[1.02] tracking-[-0.035em] text-[#f6ead8] md:text-[2.8rem] lg:text-[3.3rem]">
              Pre-loved, <span className="text-[#ead7b7]">right here</span> on campus.
            </h1>
            <p className="mt-4 text-sm leading-6 text-[#bba995]">Books, cycles, and room essentials, passed from student to student.</p>
            <Button asChild variant="secondary" size="sm" className="mt-5 rounded-full">
              <Link href="/categories">Browse</Link>
            </Button>
          </div>
          <div className="mx-auto w-full max-w-[360px] rounded-[1.5rem] bg-[#ead7b7] p-3 shadow-[0_24px_70px_rgba(0,0,0,0.28)] ring-1 ring-[#f3e5ca]/70 md:justify-self-end">
            <Image src="/brand/re-love-logo.webp" alt="Re-Love logo" width={1024} height={1024} preload className="aspect-square h-auto w-full rounded-[1.1rem] object-contain" />
          </div>
        </div>
      </section>
      <Suspense fallback={<div className="h-9" />}>
        <CategoryChips />
      </Suspense>
      <Suspense fallback={<div className="h-10 rounded-xl bg-[#1a100c]" />}>
        <Filters />
      </Suspense>
      <Suspense fallback={<p className="py-6 text-sm text-[#bba995]">Loading your finds…</p>}>
        <ListingFeed />
      </Suspense>
    </div>
  );
}
