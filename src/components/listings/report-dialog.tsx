"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSession } from "@/lib/client/session";

export function ReportDialog({ listingId, open, onOpenChange }: { listingId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useSession();
  const [reason, setReason] = React.useState("spam");
  const [details, setDetails] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [msg, setMsg] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (session?.mode === "demo") {
      setStatus("error");
      setMsg("Reporting is disabled in demo mode. Sign in to report listings.");
      return;
    }
    setStatus("loading");
    setMsg("");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_id: listingId, reason, details }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to report");
      setStatus("success");
      setMsg("Report submitted. Thank you.");
    } catch (err) {
      setStatus("error");
      setMsg(err instanceof Error ? err.message : "Failed to submit report");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Report listing</DialogTitle>
          <DialogDescription>Help keep the marketplace safe. Reports are reviewed by moderators.</DialogDescription>
        </DialogHeader>
        {status === "success" ? (
          <div className="rounded-lg border border-[#ead7b7] bg-[#4a3025] p-4 text-sm text-[#f6ead8]">{msg}</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="report-reason">Reason</Label>
              <Select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1">
                <option value="spam">Spam</option>
                <option value="prohibited">Prohibited item</option>
                <option value="misleading">Misleading information</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea id="report-details" placeholder="Add context…" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} className="mt-1" />
              <p className="mt-1 text-xs text-[#bba995]">{details.length}/1000</p>
            </div>
            {status === "error" && <p className="text-sm text-red-400" role="alert">{msg}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={status === "loading"}>{status === "loading" ? "Submitting…" : "Submit report"}</Button>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
