"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

export function ImageToggle({ imageUrl, cutoutUrl, title, displayMode }: {
  imageUrl: string;
  cutoutUrl: string | null;
  title: string;
  displayMode: "original" | "cutout" | "both";
}) {
  const hasCutout = Boolean(cutoutUrl) && displayMode !== "original";
  const [mode, setMode] = React.useState<"original" | "cutout">(displayMode === "cutout" && cutoutUrl ? "cutout" : "original");
  const src = mode === "cutout" && hasCutout && cutoutUrl ? cutoutUrl : imageUrl;

  return (
    <div className="space-y-2.5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#01071d] ring-1 ring-[#021640]/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title} className="h-full w-full object-contain" />
      </div>
      {displayMode === "both" && hasCutout && <div className="flex gap-1.5">
        <Button variant={mode === "original" ? "primary" : "secondary"} size="sm" onClick={() => setMode("original")} className="h-7 px-3 text-xs">Original</Button>
        <Button variant={mode === "cutout" ? "primary" : "secondary"} size="sm" onClick={() => setMode("cutout")} className="h-7 px-3 text-xs">Cutout</Button>
      </div>}
      <p className="text-xs leading-5 text-[#9AA4B8]">{displayMode === "both" && hasCutout ? "Seller chose to show both views. Original is always preserved." : displayMode === "cutout" && hasCutout ? "Seller chose the generated cutout. The original remains preserved." : "Seller chose the original photo."}</p>
    </div>
  );
}
