"use client";
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/lib/client/session";
import { PushOptInCard } from "@/components/notifications/push-opt-in";

export default function ProfilePage() {
  const { session, refresh, loading } = useSession();
  const [name, setName] = React.useState<string | null>(null);
  const [block, setBlock] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");



  async function save(e: React.FormEvent){
    e.preventDefault();
    if(session?.mode==="demo"){ setErr("Demo mode is read-only. Sign in to update your profile."); return;}
    setSaving(true); setErr(""); setMsg("");
    try{
      const res = await fetch("/api/profile", { method:"PATCH", headers:{ "Content-Type":"application/json"}, body: JSON.stringify({ display_name: (name ?? session?.user?.display_name ?? "").trim(), hostel_block: (block ?? session?.user?.hostel_block ?? "").trim() || null })});
      const json = await res.json();
      if(!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      await refresh(); setMsg("Profile updated");
    }catch(e){ setErr(e instanceof Error ? e.message : "Update failed");}
    finally{setSaving(false);}
  }

  if(loading) return <p className="text-sm text-[#9AA4B8]">Loading your profile…</p>;
  if(!session?.user){
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-[#021640] bg-[#01071d] p-8 text-center">
        <h1 className="font-semibold text-[#F5F5F7]">Profile</h1>
        <p className="mt-2 text-sm text-[#9AA4B8]">Sign in to manage your profile.</p>
        <Button asChild variant="primary" className="mt-4"><Link href="/login">Sign in with Google</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="pb-2">
        <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F7]">Profile</h1>
        <p className="mt-1 text-sm text-[#9AA4B8]">Display name and hostel block.</p>
      </div>
      {session.mode==="demo" && <div className="rounded-xl bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8] ring-1 ring-[#4a102f]">Demo — changes not saved. <Link href="/login" className="underline decoration-[#f5c6d8] underline-offset-4 hover:text-white">Sign in</Link> to edit.</div>}
      <Card>
        <CardHeader><CardTitle>Your details</CardTitle><CardDescription>Shown with your listings.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="pname">Display name</Label>
              <Input id="pname" value={name ?? session?.user?.display_name ?? ""} onChange={(e)=>setName(e.target.value)} maxLength={60} required className="mt-1.5 bg-[#020102]" />
            </div>
            <div>
              <Label htmlFor="pblock">Hostel block</Label>
              <Input id="pblock" value={block ?? session?.user?.hostel_block ?? ""} onChange={(e)=>setBlock(e.target.value)} maxLength={60} className="mt-1.5 bg-[#020102]" placeholder="e.g. A Block" />
            </div>
            {err && <p role="alert" className="rounded-xl bg-[#220815] p-3 text-sm text-[#f5c6d8] ring-1 ring-[#4a102f]">{err}</p>}
            {msg && <p role="status" className="rounded-xl bg-[#01071d] p-3 text-sm text-[#F5F5F7] ring-1 ring-[#03245e]/60">{msg}</p>}
            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" disabled={saving}>{saving?"Saving…":"Save changes"}</Button>
              <Button asChild variant="ghost" size="sm"><Link href="/my-listings">My listings</Link></Button>
            </div>
          </form>
        </CardContent>
        </Card>
        <PushOptInCard />
        <p className="text-center text-[11px] leading-4 text-[#9AA4B8]">
          In-app message toasts appear while Re-Love is open (30s visible-tab check, focus refresh). Email &amp; closed-app push require owner-approved schema — see docs/NOTIFICATION-PROPOSAL.md, no external sends yet.
        </p>
      </div>
  );
}
