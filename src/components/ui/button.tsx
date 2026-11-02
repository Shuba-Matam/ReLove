import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#03245e] text-white hover:bg-[#04307d] border border-[#03245e]",
        primary: "bg-[#03245e] text-white hover:bg-[#04307d] border border-[#03245e]",
        secondary: "bg-[#020102] text-[#F5F5F7] ring-1 ring-[#021640] hover:bg-[#01071d] hover:ring-[#03245e] hover:text-white",
        outline: "border border-[#021640]/70 bg-transparent text-[#F5F5F7] hover:bg-[#01071d] hover:border-[#03245e]",
        ghost: "text-[#9AA4B8] hover:text-[#F5F5F7] hover:bg-[#01071d] border border-transparent",
        destructive: "bg-[#220815] text-[#f5c6d8] ring-1 ring-[#4a102f] hover:bg-[#3a0e24] hover:text-white",
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
