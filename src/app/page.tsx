import { Suspense } from "react";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";

export default function HomePage() {
  return (
    <div className="space-y-6 md:space-y-8">
      <section className="relative overflow-hidden rounded-[1.75rem] bg-[#241712] ring-1 ring-[#4a3025]/70">
        <div aria-hidden="true" className="absolute -right-16 -top-24 size-72 rounded-full bg-[#ead7b7]/[0.07] blur-3xl" />
        <div aria-hidden="true" className="absolute bottom-0 right-0 h-px w-2/3 bg-gradient-to-l from-[#ead7b7]/35 to-transparent" />
        <div className="relative px-5 py-9 sm:px-8 sm:py-12 md:px-12 md:py-16 lg:px-16 lg:py-20">
          <div className="max-w-[760px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#c9b8a4]">Campus marketplace</p>
            <h1 className="mt-4 text-balance text-[2.35rem] font-semibold leading-[0.98] tracking-[-0.045em] text-[#f6ead8] sm:text-[3.2rem] md:text-[4.15rem] lg:text-[4.8rem]">
              Pre-loved, <span className="text-[#ead7b7]">right here</span> on campus.
            </h1>
            <div className="mt-6 border-l border-[#75513e] pl-4 sm:pl-5"><p className="max-w-[48ch] text-sm leading-6 text-[#c9b8a4] sm:text-base sm:leading-7">Books, cycles, and room essentials, passed from student to student.</p><p className="mt-2 text-xs text-[#a99482]">Buy or sell anything, effortlessly.</p></div>
          </div>
        </div>
      </section>
      <Suspense fallback={<div className="h-10 rounded-xl bg-[#1a100c]" />}>
        <Filters includeCategories />
      </Suspense>
      <Suspense fallback={<p className="py-6 text-sm text-[#bba995]">Loading your finds…</p>}>
        <ListingFeed />
      </Suspense>
    </div>
  );
}
