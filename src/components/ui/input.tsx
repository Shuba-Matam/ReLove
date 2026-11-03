import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-full bg-[#1a100c] px-3.5 py-2 text-[13px] text-[#f6ead8] placeholder:text-[#bba995] ring-1 ring-[#4a3025]/70 focus:ring-2 focus:ring-[#e6c79c] focus:ring-offset-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
export { Input };
