import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full rounded-xl bg-[#020102] px-3.5 py-3 text-[13px] leading-5 text-[#F5F5F7] placeholder:text-[#6b7280] ring-1 ring-[#021640]/60 focus:ring-2 focus:ring-[#60a5fa]/30 focus:outline-none disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
export { Textarea };
