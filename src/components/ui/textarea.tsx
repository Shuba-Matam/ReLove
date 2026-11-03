import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] min-w-0 w-full rounded-xl bg-[#1a100c] px-3.5 py-3 text-[13px] leading-5 text-[#f6ead8] placeholder:text-[#bba995] ring-1 ring-[#4a3025]/60 focus:ring-2 focus:ring-[#e6c79c] focus:outline-none disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
export { Textarea };
