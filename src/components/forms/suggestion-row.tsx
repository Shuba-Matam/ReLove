import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SuggestionRow({ label, value, applied, onApply }: { label: string; value: string; applied: boolean; onApply: () => void }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-2 rounded-xl bg-[#241712] px-3 py-2.5 text-xs ring-1 ring-[#4a3025]/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <p className="min-w-0 max-w-full whitespace-pre-wrap break-words leading-5 text-[#bba995] [overflow-wrap:anywhere]">{label}: <span className="text-[#f6ead8]">{value}</span></p>
      <Button type="button" variant={applied ? "secondary" : "ghost"} size="sm" className="min-h-8 w-full shrink-0 sm:w-auto" onClick={onApply} aria-label={`${applied ? "Reapply" : "Apply"} ${label.toLowerCase()} suggestion`}>
        {applied ? <><Check className="size-3.5" /> Applied</> : "Apply"}
      </Button>
    </div>
  );
}
