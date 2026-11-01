import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CONDITION_LABELS } from "@/lib/marketplace";
import type { Listing } from "@/lib/marketplace";

export function ListingCard({ listing }: { listing: Listing }) {
  const sold = listing.status === "sold";
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-[#021640] bg-[#01071d] transition hover:border-[#03245e] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#020102]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.image_url || "/demo/books.svg"}
          alt={listing.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
        {sold && (
          <span className="absolute left-2 top-2 rounded-full border border-[#4a102f] bg-[#220815] px-2.5 py-1 text-xs font-semibold text-white">Sold</span>
        )}
        {listing.status === "hidden" && (
          <span className="absolute left-2 top-2 rounded-full border border-[#4a102f] bg-[#220815] px-2.5 py-1 text-xs font-semibold text-white">Hidden</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-[15px] font-semibold leading-tight text-[#F5F5F7] line-clamp-2">{listing.title}</p>
        <p className="text-sm font-semibold text-[#F5F5F7]">{formatPrice(listing.price_inr)}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Badge variant="condition">{CONDITION_LABELS[listing.condition] ?? listing.condition}</Badge>
          <Badge variant="default">{listing.hostel_block}</Badge>
        </div>
      </div>
    </Link>
  );
}
