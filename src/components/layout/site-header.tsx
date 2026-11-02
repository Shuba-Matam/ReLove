"use client";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { Search, Plus, Mail, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/client/session";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { session } = useSession();
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
    <header className="sticky top-0 z-40 w-full border-b border-[#021640]/40 bg-[#020102]/95 backdrop-blur supports-[backdrop-filter]:bg-[#020102]/85">
      {isDemo && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 bg-[#220815] px-4 py-1.5 text-center text-xs">
          <span className="rounded bg-[#03245e] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#F5F5F7]">Demo</span>
          <span className="text-[#F5F5F7]/80">Sample listings · publishing paused</span>
        </div>
      )}
      <div className="mx-auto flex h-[52px] max-w-7xl items-center gap-3 px-4 md:gap-4 md:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full px-1 py-1 transition hover:bg-[#01071d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]">
          <span className="flex size-7 items-center justify-center rounded-full bg-[#03245e] text-[12px] font-bold tracking-tight text-white">R♥</span>
          <span className="hidden text-[14px] font-semibold tracking-tight text-[#F5F5F7] sm:inline">Re-Love</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden items-center gap-1 text-[13px] md:flex">
          <Link href="/" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-1 focus-visible:ring-offset-[#020102]", pathname === "/" ? "bg-[#03245e] text-white" : "text-[#9AA4B8] hover:bg-[#01071d] hover:text-[#F5F5F7]")}>Home</Link>
          <Link href="/categories" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-1 focus-visible:ring-offset-[#020102]", pathname.startsWith("/categories") ? "bg-[#03245e] text-white" : "text-[#9AA4B8] hover:bg-[#01071d] hover:text-[#F5F5F7]")}>Categories</Link>
          <Link href="/search" className={cn("rounded-full px-3 py-1.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-1 focus-visible:ring-offset-[#020102]", pathname.startsWith("/search") ? "bg-[#03245e] text-white" : "text-[#9AA4B8] hover:bg-[#01071d] hover:text-[#F5F5F7]")}>Search</Link>
        </nav>

        {/* Search - desktop */}
        <form onSubmit={onSearch} className="hidden flex-1 items-center gap-2 md:flex md:max-w-[360px]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9AA4B8]" aria-hidden="true" />
            <Input aria-label="Search listings" placeholder="Search textbooks, cycles…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 bg-[#020102] pl-9 text-[13px] border-[#021640]/70" />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:gap-1.5">
          <Button asChild variant="primary" size="sm" className="hidden rounded-full md:inline-flex">
            <Link href="/sell"><Plus className="size-3.5" /> Sell</Link>
          </Button>
          <Link aria-label="Sell" href="/sell" className="inline-flex size-8 items-center justify-center rounded-full bg-[#03245e] text-white transition hover:bg-[#04307d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102] md:hidden">
            <Plus className="size-4" />
          </Link>

          <Button asChild variant="ghost" size="icon" aria-label="Inbox" className="size-8">
            <Link href="/inbox"><Mail className="size-[18px]" /></Link>
          </Button>

          {session?.user ? (
            <div className="flex items-center gap-1">
              <Link href="/profile" aria-label="Profile" className="flex items-center gap-2 rounded-full px-1.5 py-1 transition hover:bg-[#01071d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]">
                {session.user.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.user.avatar_url} alt={`${session.user.display_name} avatar`} className="size-7 rounded-full object-cover border border-[#021640]/60" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#01071d] border border-[#021640] text-xs font-medium text-[#F5F5F7]">{session.user.display_name.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="hidden max-w-[120px] truncate text-[13px] font-medium text-[#F5F5F7] lg:inline">{session.user.display_name}</span>
              </Link>
              <form action="/auth/logout" method="post">
                <button aria-label="Sign out" type="submit" className="inline-flex size-8 items-center justify-center rounded-full text-[#9AA4B8] transition hover:bg-[#01071d] hover:text-[#F5F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020102]">
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
      <div className="border-t border-[#021640]/30 px-4 py-2 md:hidden">
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9AA4B8]" aria-hidden="true" />
            <Input aria-label="Search listings" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 bg-[#020102] pl-9 text-[13px]" />
          </div>
          <Button type="submit" size="sm" variant="primary" className="rounded-full px-5">Go</Button>
        </form>
      </div>
    </header>
  );
}
