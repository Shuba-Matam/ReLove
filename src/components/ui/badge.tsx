import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", {
  variants: {
    variant: {
      default: "border-[#021640] bg-[#01071d] text-[#9AA4B8]",
      sold: "border-[#4a102f] bg-[#220815] text-[#f5c6d8]",
      condition: "border-[#03245e] bg-[#021640] text-[#F5F5F7]",
      outline: "text-[#F5F5F7] border-[#03245e]",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
