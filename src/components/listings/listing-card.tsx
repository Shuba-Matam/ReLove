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
      className="group flex flex-col overflow-hidden rounded-2xl border border-[#021640] bg-[#01071d] transition hover:border-[#03245e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#020102]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.image_url || "/demo/books.svg"}
          alt={listing.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.015]"
          loading="lazy"
        />
        {sold && (
          <span className="absolute left-2.5 top-2.5 rounded-full border border-[#4a102f] bg-[#220815] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">Sold</span>
        )}
        {listing.status === "hidden" && (
          <span className="absolute left-2.5 top-2.5 rounded-full border border-[#4a102f] bg-[#220815] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">Hidden</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="line-clamp-2 text-[13.5px] font-medium leading-[1.35] tracking-tight text-[#F5F5F7]">{listing.title}</p>
        <p className="text-[13px] font-semibold tracking-tight text-[#F5F5F7]">{formatPrice(listing.price_inr)}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <Badge variant="condition">{CONDITION_LABELS[listing.condition] ?? listing.condition}</Badge>
          <Badge variant="default" className="max-w-[110px] truncate">{listing.hostel_block}</Badge>
        </div>
      </div>
    </Link>
  );
}
