import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium leading-none tracking-wide transition ring-1", {
  variants: {
    variant: {
      default: "ring-[#4a3025]/60 bg-[#1a100c] text-[#bba995]",
      sold: "ring-[#6b3434] bg-[#32171a] text-[#f1c7bd]",
      condition: "ring-[#4a3025]/50 bg-[#241712] text-[#e1d2c0]",
      outline: "text-[#bba995] ring-[#4a3025]/60 bg-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
