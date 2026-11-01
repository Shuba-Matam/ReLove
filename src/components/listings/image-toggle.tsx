"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

export function ImageToggle({ imageUrl, cutoutUrl, title }: { imageUrl: string; cutoutUrl: string | null; title: string }) {
  const [mode, setMode] = React.useState<"original" | "cutout">("original");
  const hasCutout = Boolean(cutoutUrl);
  const src = mode === "cutout" && cutoutUrl ? cutoutUrl : imageUrl;

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#021640] bg-[#020102]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} className="h-full w-full object-contain" />
      </div>
      <div className="flex gap-2">
        <Button variant={mode === "original" ? "primary" : "secondary"} size="sm" onClick={() => setMode("original")}>Original</Button>
        <Button variant={mode === "cutout" ? "primary" : "secondary"} size="sm" disabled={!hasCutout} onClick={() => setMode("cutout")} title={hasCutout ? "Show cutout" : "No cutout available"}>Cutout</Button>
      </div>
      {!hasCutout && <p className="text-xs text-[#9AA4B8]">Background-removed cutout will appear here when available.</p>}
    </div>
  );
}
