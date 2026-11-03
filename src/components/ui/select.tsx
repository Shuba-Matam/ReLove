import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "flex h-9 w-full appearance-none rounded-full bg-[#1a100c] px-3.5 pr-8 py-2 text-[13px] text-[#f6ead8] ring-1 ring-[#4a3025]/60 focus:ring-2 focus:ring-[#e6c79c] focus:outline-none",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-[#bba995]" aria-hidden="true" />
    </div>
  );
}
