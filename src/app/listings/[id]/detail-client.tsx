"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImageToggle } from "@/components/listings/image-toggle";
import { ReportDialog } from "@/components/listings/report-dialog";
import { CONDITION_LABELS } from "@/lib/marketplace";
import { useSession } from "@/lib/client/session";
import type { Listing } from "@/lib/marketplace";
import { Flag, MessageCircle, Pencil } from "lucide-react";

export function ListingDetailClient({ listing, mode }: { listing: Listing; mode: string }) {
  const router = useRouter();
  const { session } = useSession();
  const [reportOpen, setReportOpen] = React.useState(false);
  const [contactLoading, setContactLoading] = React.useState(false);
  const [contactError, setContactError] = React.useState("");
  const [processing, setProcessing] = React.useState(false);
  const [cutoutMessage, setCutoutMessage] = React.useState("");
  async function createCutout() { setProcessing(true); setCutoutMessage(""); try { const response = await fetch("/api/ai/cutout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({listing_id:listing.id})}); const result = await response.json(); if(!response.ok) throw new Error(result.error?.message || "Cutout unavailable. Your original is unchanged."); router.refresh(); setCutoutMessage("Cutout ready. You can switch back to your original at any time."); } catch(error) { setCutoutMessage(error instanceof Error ? error.message : "Cutout unavailable. Your original is unchanged."); } finally { setProcessing(false); } }
  const isOwner = session?.user?.id === listing.seller_id;
  const isDemo = mode === "demo" || session?.mode === "demo";

  async function handleContact() {
    if (isDemo) {
      setContactError("This is a sample listing. Messaging opens when the marketplace is connected.");
      return;
    }
    if (!session?.user) {
      router.push(`/login?next=/listings/${listing.id}`);
      return;
    }
    setContactLoading(true);
    setContactError("");
    try {
      const res = await fetch("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listing_id: listing.id }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to start conversation");
      const id = json.data?.id ?? json.id;
      router.push(`/inbox/${id}`);
    } catch (e) {
      setContactError(e instanceof Error ? e.message : "Failed to contact seller");
    } finally { setContactLoading(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
      <div>
        <ImageToggle imageUrl={listing.image_url} cutoutUrl={listing.cutout_url} title={listing.title} />
        {isOwner && session?.ai_enabled && !listing.cutout_url && <Button className="mt-3" variant="secondary" disabled={processing} onClick={createCutout}>{processing ? "Preparing cutout…" : "Create optional cutout"}</Button>}
        {cutoutMessage && <p role="status" className="mt-2 text-sm text-[#9AA4B8]">{cutoutMessage}</p>}
      </div>

      <div className="space-y-4">
        {isDemo && <p className="text-xs font-medium uppercase tracking-widest text-[#9AA4B8]">Illustrative sample · not for sale</p>}
        {listing.status === "hidden" && <p role="status" className="rounded-xl border border-[#4a102f] bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8]">This listing is hidden pending review. It is visible only to you.</p>}
        {listing.status === "sold" && <Badge variant="sold" className="px-3 py-1.5 text-xs">Sold — no longer available</Badge>}
        <div>
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight text-[#F5F5F7] md:text-[1.7rem]">{listing.title}</h1>
          <p className="mt-2 text-xl font-semibold tracking-tight text-[#F5F5F7]">{formatPrice(listing.price_inr)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="condition">{CONDITION_LABELS[listing.condition]}</Badge>
          <Badge variant="default">{listing.hostel_block}</Badge>
          {listing.category && <Badge variant="outline">{listing.category.name}</Badge>}
        </div>

        <Card>
          <CardHeader><CardTitle>Description</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap text-sm leading-6 text-[#cbd5e1]">{listing.description}</p>
            {listing.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {listing.tags.map((t) => <span key={t} className="rounded-full border border-[#021640] bg-[#020102] px-2.5 py-1 text-xs text-[#9AA4B8]">#{t}</span>)}
              </div>
            )}
          </CardContent>
        </Card>

        {listing.seller && (
          <Card>
            <CardHeader><CardTitle>Seller</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {listing.seller.avatar_url ? <img src={listing.seller.avatar_url} alt={`${listing.seller.display_name} avatar`} className="size-10 rounded-full object-cover border border-[#021640]" /> : <span className="flex size-10 items-center justify-center rounded-full bg-[#021640] border border-[#03245e] text-sm font-medium text-[#F5F5F7]">{listing.seller.display_name.slice(0,1).toUpperCase()}</span>}
              <div>
                <p className="text-sm font-medium text-[#F5F5F7]">{listing.seller.display_name}</p>
                <p className="text-xs text-[#9AA4B8]">{listing.seller.hostel_block ?? "Hostel not set"}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!isOwner ? (
            <Button onClick={handleContact} disabled={contactLoading || listing.status === "sold"} variant="primary">
              <MessageCircle className="size-4" /> {contactLoading ? "Opening…" : listing.status === "sold" ? "Sold" : "Message seller"}
            </Button>
          ) : (
            <Button asChild variant="secondary"><Link href={`/listings/${listing.id}/edit`}><Pencil className="size-4" /> Edit listing</Link></Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}><Flag className="size-4" /> Report</Button>
        </div>
        {contactError && <p role="alert" className="rounded-xl border border-[#4a102f] bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8]">{contactError} {isDemo && <Link href="/login" className="underline text-[#82b7ff] underline-offset-4">Sign in</Link>}</p>}

        {isOwner && (
          <div className="flex gap-2 pt-2">
            <Button asChild variant="secondary" size="sm"><Link href="/my-listings">My listings</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link href="/">Back home</Link></Button>
          </div>
        )}

        <ReportDialog listingId={listing.id} open={reportOpen} onOpenChange={setReportOpen} />
      </div>
    </div>
  );
}
