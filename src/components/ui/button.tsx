import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#ead7b7] text-[#241712] hover:bg-[#f3e5ca] border border-[#ead7b7] shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
        primary: "bg-[#ead7b7] text-[#241712] hover:bg-[#f3e5ca] border border-[#ead7b7] shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
        secondary: "bg-[#1a100c] text-[#f6ead8] ring-1 ring-[#4a3025] hover:bg-[#241712] hover:ring-[#ead7b7] hover:text-white",
        outline: "border border-[#4a3025]/70 bg-transparent text-[#f6ead8] hover:bg-[#241712] hover:border-[#ead7b7]",
        ghost: "text-[#bba995] hover:text-[#f6ead8] hover:bg-[#241712] border border-transparent",
        destructive: "bg-[#32171a] text-[#f1c7bd] ring-1 ring-[#6b3434] hover:bg-[#472126] hover:text-white",
      },
      size: {
        default: "h-9 px-4 py-2 text-[13px]",
        sm: "h-8 rounded-full px-3.5 text-xs",
        lg: "h-10 rounded-full px-6",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
