"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

export function ImageToggle({ imageUrl, cutoutUrl, title }: { imageUrl: string; cutoutUrl: string | null; title: string }) {
  const [mode, setMode] = React.useState<"original" | "cutout">("original");
  const hasCutout = Boolean(cutoutUrl);
  const src = mode === "cutout" && cutoutUrl ? cutoutUrl : imageUrl;

  return (
    <div className="space-y-2.5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#01071d] ring-1 ring-[#021640]/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} className="h-full w-full object-contain" />
      </div>
      <div className="flex gap-1.5">
        <Button variant={mode === "original" ? "primary" : "secondary"} size="sm" onClick={() => setMode("original")} className="h-7 px-3 text-xs">Original</Button>
        <Button variant={mode === "cutout" ? "primary" : "secondary"} size="sm" disabled={!hasCutout} onClick={() => setMode("cutout")} title={hasCutout ? "Show cutout" : "No cutout available"} className="h-7 px-3 text-xs">Cutout</Button>
      </div>
      <p className="text-xs leading-5 text-[#9AA4B8]">{hasCutout ? "Original is always available — switch views above." : "Cutout appears here when available. Original is the source of truth."}</p>
    </div>
  );
}
