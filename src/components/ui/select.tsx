import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "flex h-9 w-full appearance-none rounded-full bg-[#020102] px-3.5 pr-8 py-2 text-[13px] text-[#F5F5F7] ring-1 ring-[#021640]/60 focus:ring-2 focus:ring-[#60a5fa]/30 focus:outline-none",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9AA4B8]" aria-hidden="true" />
    </div>
  );
}
