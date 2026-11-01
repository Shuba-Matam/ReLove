import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#03245e] text-[#F5F5F7] hover:bg-[#04307d] border border-[#03245e]",
        primary: "bg-[#03245e] text-white hover:bg-[#04307d] border border-[#03245e]",
        secondary: "bg-[#01071d] text-[#F5F5F7] border border-[#021640] hover:bg-[#021640] hover:border-[#03245e]",
        outline: "border border-[#03245e] bg-transparent text-[#F5F5F7] hover:bg-[#021640]",
        ghost: "text-[#9AA4B8] hover:text-[#F5F5F7] hover:bg-[#01071d]",
        destructive: "bg-[#220815] text-[#F5F5F7] border border-[#4a102f] hover:bg-[#3a0e24]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9",
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
