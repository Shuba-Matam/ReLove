"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Plus, Mail, User } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/categories", label: "Categories", icon: LayoutGrid },
  { href: "/sell", label: "Sell", icon: Plus },
  { href: "/inbox", label: "Inbox", icon: Mail },
  { href: "/profile", label: "You", icon: User },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary mobile navigation" className="fixed bottom-0 left-0 right-0 z-40 flex min-h-[64px] items-center justify-around border-t border-[#021640] bg-[#01071d] px-2 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:hidden">
      {tabs.map((t) => {
        const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-medium",
              active ? "text-[#F5F5F7] bg-[#021640]" : "text-[#9AA4B8]"
            )}
          >
            <Icon className={cn("size-5", active && "text-[#60a5fa]")} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
