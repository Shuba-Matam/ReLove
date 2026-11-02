import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { CategoryChips } from "@/components/listings/category-chips";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="space-y-6 md:space-y-8">
      <section className="pt-1 md:pt-2">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[48ch]">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#9AA4B8]">Campus marketplace</p>
            <h1 className="mt-2 text-balance text-[1.7rem] font-semibold leading-[1.05] tracking-[-0.02em] text-[#F5F5F7] md:text-[2.2rem]">
              Pre-loved, <span className="text-[#82b7ff]">right here</span> on campus.
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#9AA4B8]">Books, cycles, room essentials — passed on student to student.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild variant="primary" size="sm" className="rounded-full">
              <Link href="/sell">Sell an item <ArrowRight className="size-3.5" /></Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className="rounded-full">
              <Link href="/categories">Browse</Link>
            </Button>
          </div>
        </div>
      </section>
      <Suspense fallback={<div className="h-9" />}>
        <CategoryChips />
      </Suspense>
      <Suspense fallback={<div className="h-10 rounded-xl bg-[#020102]" />}>
        <Filters />
      </Suspense>
      <Suspense fallback={<p className="py-6 text-sm text-[#9AA4B8]">Loading your finds…</p>}>
        <ListingFeed />
      </Suspense>
    </div>
  );
}
