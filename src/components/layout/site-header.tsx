"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { Search, Plus, Bell, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/client/session";
import { useNotifications } from "@/lib/client/notifications";
import { UnreadBadge } from "@/components/notifications/unread-badge";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { session } = useSession();
  const { unreadCount } = useNotifications();
  const isDemo = session?.mode === "demo";
  const qInit = sp.get("q") ?? "";
  const [search, setSearch] = React.useState<{ route: string; value: string } | null>(null);
  const q = search?.route === sp.toString() ? search.value : qInit;
  const setQ = (value: string) => setSearch({ route: sp.toString(), value });

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/search?${params.toString()}`);
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#4a3025]/40 bg-[#1a100c]/95 backdrop-blur supports-[backdrop-filter]:bg-[#1a100c]/85">
      {isDemo && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 bg-[#32171a] px-4 py-1.5 text-center text-xs">
          <span className="rounded bg-[#ead7b7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#241712]">Demo</span>
          <span className="text-[#f6ead8]/80">Sample listings · publishing paused</span>
        </div>
      )}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:gap-4 md:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full px-1 py-1 transition hover:bg-[#241712] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c]">
          <Image src="/brand/re-love-logo.webp" alt="" width={36} height={36} className="size-9 rounded-full object-contain ring-1 ring-[#75513e]/70" />
          <span className="hidden text-[14px] font-semibold tracking-tight text-[#f6ead8] sm:inline">Re-Love</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden h-10 items-center gap-1 text-[13px] md:flex">
          <Link href="/" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-1 focus-visible:ring-offset-[#1a100c]", pathname === "/" ? "bg-[#ead7b7] text-[#241712]" : "text-[#bba995] hover:bg-[#241712] hover:text-[#f6ead8]")}>Home</Link>
          <Link href="/categories" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-1 focus-visible:ring-offset-[#1a100c]", pathname.startsWith("/categories") ? "bg-[#ead7b7] text-[#241712]" : "text-[#bba995] hover:bg-[#241712] hover:text-[#f6ead8]")}>Browse</Link>
          <Link href="/search" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-1 focus-visible:ring-offset-[#1a100c]", pathname.startsWith("/search") ? "bg-[#ead7b7] text-[#241712]" : "text-[#bba995] hover:bg-[#241712] hover:text-[#f6ead8]")}>Search</Link>
        </nav>

        {/* Search - desktop */}
        <form onSubmit={onSearch} className="hidden flex-1 items-center gap-2 md:flex md:max-w-[360px]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#bba995]" aria-hidden="true" />
            <Input aria-label="Search listings" placeholder="Search textbooks, cycles…" value={q} onChange={(e) => setQ(e.target.value)} className="h-10 bg-[#1a100c] pl-9 text-[13px] border-[#4a3025]/70" />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:gap-1.5">
          <Button asChild variant="primary" size="sm" className="hidden rounded-full md:inline-flex">
            <Link href="/sell"><Plus className="size-3.5" /> Sell</Link>
          </Button>
          <Link aria-label="Sell" href="/sell" className="inline-flex size-10 items-center justify-center rounded-full bg-[#ead7b7] text-[#241712] transition hover:bg-[#f3e5ca] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c] md:hidden">
            <Plus className="size-5" />
          </Link>

          <Button asChild variant="ghost" size="icon" aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox"} className="relative size-10">
            <Link href="/inbox">
              <Bell className="size-5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1">
                  <UnreadBadge count={unreadCount} className="min-h-[18px] min-w-[18px] px-1 text-[10px] leading-none" />
                </span>
              )}
            </Link>
          </Button>

          {session?.user ? (
            <div className="flex items-center gap-1">
              <Link href="/profile" aria-label="Profile" className="flex min-h-10 items-center gap-2 rounded-full px-1.5 py-1 transition hover:bg-[#241712] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c]">
                {session.user.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.avatar_url} alt={`${session.user.display_name} avatar`} className="size-7 rounded-full object-cover border border-[#4a3025]/60" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#241712] border border-[#4a3025] text-xs font-medium text-[#f6ead8]">{session.user.display_name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="hidden max-w-[120px] truncate text-[13px] font-medium text-[#f6ead8] lg:inline">{session.user.display_name}</span>
              </Link>
              <form action="/auth/logout" method="post">
                <button aria-label="Sign out" type="submit" className="inline-flex size-10 items-center justify-center rounded-full text-[#bba995] transition hover:bg-[#241712] hover:text-[#f6ead8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c]">
                  <LogOut className="size-4" />
                </button>
              </form>
            </div>
          ) : (
            <Button asChild variant="secondary" size="sm" className="rounded-full">
              <Link href="/login"><User className="size-3.5" /> Sign in</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Mobile search */}
      <div className="border-t border-[#4a3025]/30 px-4 py-2 md:hidden">
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#bba995]" aria-hidden="true" />
            <Input aria-label="Search listings" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 bg-[#1a100c] pl-9 text-[13px]" />
          </div>
          <Button type="submit" size="sm" variant="primary" className="rounded-full px-5">Go</Button>
        </form>
      </div>
    </header>
  );
}
