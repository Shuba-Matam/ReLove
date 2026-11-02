import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium leading-none tracking-wide transition ring-1", {
  variants: {
    variant: {
      default: "ring-[#021640]/60 bg-[#020102] text-[#9AA4B8]",
      sold: "ring-[#4a102f] bg-[#220815] text-[#f5c6d8]",
      condition: "ring-[#021640]/50 bg-[#01071d] text-[#cbd5e1]",
      outline: "text-[#9AA4B8] ring-[#021640]/60 bg-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
