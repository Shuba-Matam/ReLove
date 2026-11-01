"use client";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { CategoryChips } from "@/components/listings/category-chips";
export function SearchClient() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[#021640] pb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9AA4B8]">Search</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#F5F5F7]">Find your next favourite.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#9AA4B8]">Search books, room essentials, and the everyday things that make campus yours.</p>
      </div>
      <CategoryChips />
      <Filters />
      <ListingFeed />
    </div>
  );
}
