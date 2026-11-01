import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, Heart } from "lucide-react";
import { CategoryChips } from "@/components/listings/category-chips";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { Button } from "@/components/ui/button";

export default function HomePage() {
 return <div className="space-y-7 md:space-y-9">
  <section className="relative overflow-hidden rounded-3xl border border-[#021640] bg-[#01071d] px-6 py-9 md:px-10 md:py-14">
   <div className="relative z-10 max-w-2xl"><p className="mb-5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[.2em] text-[#82b7ff]"><Heart className="size-3" /> LESS NEW. MORE YOU.</p>
   <h1 className="max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">Good things deserve<br /><span className="text-[#82b7ff]">a second story.</span></h1>
   <p className="mt-5 max-w-lg text-sm leading-7 text-[#9AA4B8] md:text-base">The books you finished. The chair you loved. Find their next person, right here on campus.</p>
   <div className="mt-7 flex flex-wrap items-center gap-4"><Button asChild variant="primary" className="h-11 rounded-full px-6"><Link href="/sell">Pass something on <ArrowUpRight className="size-4" /></Link></Button><span className="text-xs text-[#9AA4B8]">A little less waste. A little more possibility.</span></div></div>
   <div className="pointer-events-none absolute -right-20 -top-16 size-96 rounded-full border border-[#163569] opacity-40" aria-hidden="true" /><div className="pointer-events-none absolute -bottom-44 right-16 size-96 rounded-full border border-[#163569] opacity-25" aria-hidden="true" />
  </section>
  <Suspense fallback={<div className="h-12" />}><CategoryChips /></Suspense>
  <Suspense fallback={<div className="h-24 rounded-xl bg-[#01071d]" />}><Filters /></Suspense>
  <Suspense fallback={<p className="text-sm text-[#9AA4B8]">Loading your finds…</p>}><ListingFeed /></Suspense>
 </div>;
}
