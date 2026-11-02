import { SellForm } from "@/components/forms/sell-form";

export default function SellPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="pb-1">
        <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F7]">Sell an item</h1>
        <p className="mt-1 text-sm leading-6 text-[#9AA4B8]">Clear photo, honest details — buyers message you directly.</p>
      </div>
      <SellForm />
    </div>
  );
}
