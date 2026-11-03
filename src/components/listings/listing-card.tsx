import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import { CONDITION_LABELS } from "@/lib/marketplace";
import type { Listing } from "@/lib/marketplace";

export function ListingCard({ listing }: { listing: Listing }) {
  const sold = listing.status === "sold";
  const coverUrl = listing.photo_display_mode === "cutout" && listing.cutout_url ? listing.cutout_url : listing.image_url;
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="group flex flex-col overflow-hidden rounded-xl bg-[#020102] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#01071d] ring-1 ring-[#021640]/60 group-hover:ring-[#03245e]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverUrl || "/demo/books.svg"}
          alt={listing.title}
          className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.015]"
          loading="lazy"
        />
        {sold && (
          <span className="absolute left-2 top-2 rounded-full bg-[#220815] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white ring-1 ring-[#4a102f]">Sold</span>
        )}
        {listing.status === "hidden" && (
          <span className="absolute left-2 top-2 rounded-full bg-[#220815] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white ring-1 ring-[#4a102f]">Hidden</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-1 pt-2.5 pb-1">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug tracking-tight text-[#F5F5F7]">{listing.title}</p>
        <p className="text-[13px] font-semibold tracking-tight text-[#F5F5F7]">{formatPrice(listing.price_inr)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="rounded-full bg-[#01071d] px-2 py-1 text-[11px] leading-none text-[#9AA4B8] ring-1 ring-[#021640]/60">{CONDITION_LABELS[listing.condition] ?? listing.condition}</span>
          <span className="max-w-[110px] truncate rounded-full bg-[#020102] px-2 py-1 text-[11px] leading-none text-[#9AA4B8] ring-1 ring-[#021640]/50">{listing.hostel_block}</span>
        </div>
      </div>
    </Link>
  );
}
