import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-full border border-[#021640] bg-[#01071d] px-3.5 py-2 text-[13px] text-[#F5F5F7] placeholder:text-[#6b7280] focus:border-[#03245e] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/30 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
export { Input };
