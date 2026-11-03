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
        "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#ead7b7] px-1.5 text-[11px] font-semibold leading-none text-[#241712] ring-1 ring-[#4a3025] transition",
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
      className={cn("absolute -right-1 -top-1 inline-flex size-2.5 items-center justify-center rounded-full bg-[#e6c79c] ring-2 ring-[#1a100c]", className)}
      aria-hidden="true"
    />
  );
}
