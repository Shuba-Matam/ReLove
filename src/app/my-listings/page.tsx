"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ListingCard } from "@/components/listings/listing-card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSession } from "@/lib/client/session";
import type { Listing } from "@/lib/marketplace";

type Tab = "active" | "sold" | "hidden";

export default function MyListingsPage() {
  const { session } = useSession();
  const [tab, setTab] = React.useState<Tab>("active");
  const [listings, setListings] = React.useState<Listing[]|null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [confirm, setConfirm] = React.useState<{id:string, action:"delete"|"sold"}|null>(null);
  const isDemo = session?.mode==="demo";

  const load = React.useCallback(async (status: Tab) => {
    try{
      const res = await fetch(`/api/my-listings?status=${status}`, { cache:"no-store"});
      const json = await res.json();
      if(!res.ok) throw new Error(json?.error?.message ?? "Failed to load");
      setListings(json.data); setError("");
    }catch(e){ setError(e instanceof Error ? e.message : "Failed to load");}
    finally{setLoading(false);}
  },[]);

  React.useEffect(() => { const controller = new AbortController(); void (async () => { await Promise.resolve(); if(!controller.signal.aborted) await load(tab); })(); return () => controller.abort(); }, [tab, load]);

  async function doAction(){
    if(!confirm) return;
    if(isDemo){ setError("Demo mode — actions are disabled. Sign in to manage listings."); setConfirm(null); return; }
    try{
      if(confirm.action==="delete"){
        const res = await fetch(`/api/listings/${confirm.id}`, { method:"DELETE"});
        const json = await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(json?.error?.message ?? "Delete failed");
      } else {
        const res = await fetch(`/api/listings/${confirm.id}`, { method:"PATCH", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ status:"sold"})});
        const json = await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      }
      setConfirm(null);
      load(tab);
    }catch(e){ setError(e instanceof Error ? e.message : "Action failed");}
  }

  if(!session?.user && !loading){
    return <div className="mx-auto max-w-lg rounded-xl border border-[#021640] bg-[#01071d] p-8 text-center"><p className="text-sm text-[#9AA4B8]">Sign in to manage your listings.</p><Button asChild variant="primary" className="mt-4"><Link href="/login">Sign in</Link></Button></div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[#F5F5F7]">My listings</h1>
      {isDemo && <div className="rounded-xl border border-[#4a102f] bg-[#220815] p-3 text-sm text-[#f5c6d8]">Demo mode — manage actions are disabled.</div>}
      <div className="flex gap-2">
        {(["active","sold","hidden"] as Tab[]).map((t)=>
          <Button key={t} variant={tab===t?"primary":"secondary"} size="sm" onClick={()=>{setLoading(true);setError("");setListings(null);setTab(t);}}>{t}</Button>
        )}
      </div>
      {loading && <p className="text-sm text-[#9AA4B8]">Loading…</p>}
      {error && <p role="alert" className="rounded-lg border border-[#4a102f] bg-[#220815] p-3 text-sm text-[#f5c6d8]">{error}</p>}
      {listings && listings.length===0 && <div className="rounded-xl border border-[#021640] bg-[#01071d] p-8 text-center text-sm text-[#9AA4B8]">No {tab} listings.</div>}
      {listings && listings.length>0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {listings.map((l)=>(
            <div key={l.id} className="space-y-2">
              <ListingCard listing={l} />
              <div className="flex flex-wrap gap-1">
                <Button asChild variant="secondary" size="sm"><Link href={`/listings/${l.id}/edit`}>Edit</Link></Button>
                {tab==="active" && <Button variant="ghost" size="sm" onClick={()=>setConfirm({id:l.id, action:"sold"})}>Mark sold</Button>}
                <Button variant="ghost" size="sm" onClick={()=>setConfirm({id:l.id, action:"delete"})}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(confirm)} onOpenChange={(o)=>!o && setConfirm(null)}>
        <DialogContent onClose={()=>setConfirm(null)}>
          <DialogHeader><DialogTitle>{confirm?.action==="delete"?"Delete listing?":"Mark as sold?"}</DialogTitle><DialogDescription>{confirm?.action==="delete"?"This will permanently remove the listing.":"This will mark the listing as sold and hide it from browsing."}</DialogDescription></DialogHeader>
          <div className="flex gap-2">
            <Button variant={confirm?.action==="delete"?"destructive":"primary"} onClick={doAction}>Confirm</Button>
            <Button variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
