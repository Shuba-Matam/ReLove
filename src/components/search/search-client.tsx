"use client";
import { Filters } from "@/components/listings/filters";
import { ListingFeed } from "@/components/listings/listing-feed";
import { CategoryChips } from "@/components/listings/category-chips";
export function SearchClient() { return <div className="space-y-6"><div><h1 className="text-3xl font-semibold tracking-tight">Find your next favourite.</h1><p className="mt-2 text-sm text-[#9AA4B8]">Search books, room essentials, and the everyday things that make campus yours.</p></div><CategoryChips /><Filters /><ListingFeed /></div>; }
