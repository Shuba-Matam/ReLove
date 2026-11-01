import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { CategoryChips } from "@/components/listings/category-chips";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="space-y-8 md:space-y-10">
      <section className="border-b border-[#021640] pb-8 md:pb-10 pt-2 md:pt-4">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#9AA4B8]">
            <span className="h-px w-7 bg-[#021640]" aria-hidden="true" />
            Less new. More you.
          </p>
          <h1 className="mt-4 text-balance text-[2rem] font-[650] leading-[0.95] tracking-[-0.03em] text-[#F5F5F7] md:mt-5 md:text-[3.4rem]">
            Good things deserve
            <br />
            <span className="text-[#82b7ff]">a second story.</span>
          </h1>
          <p className="mt-4 max-w-[46ch] text-sm leading-6 text-[#9AA4B8] md:text-[15px] md:leading-7">
            The books you finished. The chair you loved. Find their next person — right here on campus. No storefront, just students passing things on.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-7">
            <Button asChild variant="primary" className="h-10 rounded-full px-5 text-[13px] font-medium">
              <Link href="/sell">Pass something on <ArrowRight className="size-3.5" /></Link>
            </Button>
            <Link href="/categories" className="inline-flex h-10 items-center rounded-full border border-[#021640] bg-[#01071d] px-5 text-[13px] font-medium text-[#F5F5F7] transition hover:border-[#03245e] hover:bg-[#020102]">
              Browse categories
            </Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#6b7280]">A little less waste. A little more possibility. Meet in public and check items before paying.</p>
        </div>
      </section>
      <Suspense fallback={<div className="h-10" />}>
        <CategoryChips />
      </Suspense>
      <Suspense fallback={<div className="h-24 rounded-xl border border-[#021640] bg-[#01071d]" />}>
        <Filters />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-[#9AA4B8]">Loading your finds…</p>}>
        <ListingFeed />
      </Suspense>
    </div>
  );
}
