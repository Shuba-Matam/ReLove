import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full rounded-2xl border border-[#021640] bg-[#01071d] px-3.5 py-3 text-[13px] leading-5 text-[#F5F5F7] placeholder:text-[#6b7280] focus:border-[#03245e] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
export { Textarea };
