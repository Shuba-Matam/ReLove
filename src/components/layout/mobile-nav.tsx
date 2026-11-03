"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, Plus, Mail, User } from "lucide-react";
import { useNotifications } from "@/lib/client/notifications";
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
  const { unreadCount } = useNotifications();
  return (
    <nav aria-label="Primary mobile navigation" className="fixed bottom-0 left-0 right-0 z-40 flex min-h-[56px] items-center justify-around border-t border-[#021640]/40 bg-[#020102] px-1 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
      {tabs.map((t) => {
        const active = pathname === t.href || (t.href !== "/" && pathname.startsWith(t.href));
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            aria-label={t.href === "/inbox" && unreadCount > 0 ? `Inbox, ${unreadCount} unread` : undefined}
            className={cn(
              "relative flex min-w-[56px] flex-col items-center justify-center gap-1 rounded-xl px-3 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa]",
              active ? "text-[#F5F5F7] bg-[#01071d]" : "text-[#9AA4B8] hover:text-[#F5F5F7]"
            )}
          >
            <span className="relative">
              <Icon className={cn("size-[18px]", active && "text-[#F5F5F7]")} aria-hidden="true" />
              {t.href === "/inbox" && unreadCount > 0 && (
                <span className="absolute -right-2 -top-1.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#03245e] px-1 text-[10px] font-semibold leading-none text-white ring-1 ring-[#021640]">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
