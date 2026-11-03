import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-full bg-[#020102] px-3.5 py-2 text-[13px] text-[#F5F5F7] placeholder:text-[#9AA4B8] ring-1 ring-[#021640]/70 focus:ring-2 focus:ring-[#60a5fa] focus:ring-offset-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
export { Input };
