import { SellForm } from "@/components/forms/sell-form";

export default function SellPage() {
  return (
    <div className="space-y-6">
      <div className="pb-1">
        <h1 className="text-xl font-semibold tracking-tight text-[#f6ead8]">Sell an item</h1>
        <p className="mt-1 text-sm leading-6 text-[#bba995]">Clear photo, honest details. Buyers message you directly.</p>
      </div>
      <SellForm />
    </div>
  );
}
