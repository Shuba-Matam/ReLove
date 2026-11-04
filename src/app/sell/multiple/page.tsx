import { notFound } from "next/navigation";
import { MultiCutoutSell } from "@/components/forms/multi-cutout-sell";
import { isMultiCutoutEnabled } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default function MultipleSellPage() {
  if (!isMultiCutoutEnabled()) notFound();
  return <div className="space-y-6">
    <div className="pb-1">
      <h1 className="text-xl font-semibold tracking-tight text-[#f6ead8]">Sell multiple items from one photo</h1>
      <p className="mt-1 text-sm leading-6 text-[#bba995]">Mark up to three items, generate each cutout explicitly, then publish separate listings.</p>
    </div>
    <MultiCutoutSell />
  </div>;
}
