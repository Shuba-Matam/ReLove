"use client";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { CategoryChips } from "@/components/listings/category-chips";
export function SearchClient() {
  return (
    <div className="space-y-6">
      <div className="pb-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9AA4B8]">Search</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#F5F5F7]">Find your next favourite</h1>
        <p className="mt-1 text-sm text-[#9AA4B8]">Books, room essentials — and everyday campus finds.</p>
      </div>
      <CategoryChips />
      <Filters />
      <ListingFeed />
    </div>
  );
}
