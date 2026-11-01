import { SellForm } from "@/components/forms/sell-form";

export default function SellPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="border-b border-[#021640] pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F7]">Sell an item</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#9AA4B8]">Add a clear photo and honest description. Buyers can message you directly — no fees, no storefront.</p>
      </div>
      <SellForm />
    </div>
  );
}
