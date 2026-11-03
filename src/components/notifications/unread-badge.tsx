"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function UnreadBadge({
  count,
  className,
  label = "unread messages",
}: {
  count: number;
  className?: string;
  label?: string;
}) {
  if (!count || count <= 0) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn(
        "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#03245e] px-1.5 text-[11px] font-semibold leading-none text-white ring-1 ring-[#021640] transition",
        // Ensure visible on dark palette
        className
      )}
      aria-label={`${count} ${label}`}
    >
      {display}
    </span>
  );
}

export function UnreadDot({ count, className }: { count: number; className?: string }) {
  if (!count || count <= 0) return null;
  return (
    <span
      className={cn("absolute -right-1 -top-1 inline-flex size-2.5 items-center justify-center rounded-full bg-[#60a5fa] ring-2 ring-[#020102]", className)}
      aria-hidden="true"
    />
  );
}
