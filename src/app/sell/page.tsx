import { SellForm } from "@/components/forms/sell-form";

export default function SellPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F7]">Sell an item</h1>
      <p className="text-sm text-[#9AA4B8]">Add a clear photo and honest description. Buyers can message you directly.</p>
      <SellForm />
    </div>
  );
}
