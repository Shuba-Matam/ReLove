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
  const [search, setSearch] = React.useState<{route:string;value:string}|null>(null);
  const q = search?.route === sp.toString() ? search.value : qInit;
  const setQ = (value:string) => setSearch({route:sp.toString(),value});

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/search?${params.toString()}`);
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#021640] bg-[#01071d]/95 backdrop-blur supports-[backdrop-filter]:bg-[#01071d]/80">
      {isDemo && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2 text-center bg-[#021640] px-4 py-1.5 text-xs text-[#F5F5F7]">
          <span className="rounded bg-[#03245e] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest">Demo mode</span>
          <span className="text-[#9AA4B8]">Sample listings · publishing and messages are not yet available</span>
        </div>
      )}
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#03245e] text-white font-bold text-sm">R♥</span>
          <span className="hidden sm:inline font-semibold tracking-tight text-[#F5F5F7]">Re-Love</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link href="/" className={cn("px-3 py-2 rounded-lg hover:bg-[#021640] text-[#9AA4B8] hover:text-[#F5F5F7]", pathname === "/" && "bg-[#021640] text-[#F5F5F7]")}>Home</Link>
          <Link href="/categories" className={cn("px-3 py-2 rounded-lg hover:bg-[#021640] text-[#9AA4B8] hover:text-[#F5F5F7]", pathname.startsWith("/categories") && "bg-[#021640] text-[#F5F5F7]")}>Categories</Link>
          <Link href="/search" className="px-3 py-2 rounded-lg hover:bg-[#021640] text-[#9AA4B8] hover:text-[#F5F5F7]">Search</Link>
        </nav>

        {/* Search - desktop */}
        <form onSubmit={onSearch} className="hidden md:flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA4B8]" />
            <Input
              aria-label="Search listings"
              placeholder="Search textbooks, cycles, furniture…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1">
          <Button asChild variant="primary" size="sm" className="hidden md:inline-flex">
            <Link href="/sell"><Plus className="size-4" /> Sell</Link>
          </Button>
          <Link aria-label="Sell" href="/sell" className="md:hidden inline-flex size-9 items-center justify-center rounded-xl bg-[#03245e] text-white">
            <Plus className="size-4" />
          </Link>

          <Button asChild variant="ghost" size="icon" aria-label="Inbox" className="relative">
            <Link href="/inbox"><Mail className="size-5" /></Link>
          </Button>

          {session?.user ? (
            <div className="flex items-center gap-1">
              <Link href="/profile" aria-label="Profile" className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-[#021640]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {session.user.avatar_url ? <img src={session.user.avatar_url} alt={`${session.user.display_name} avatar`} className="size-8 rounded-full object-cover border border-[#021640]" /> : <span className="flex size-8 items-center justify-center rounded-full bg-[#021640] border border-[#03245e] text-sm">{session.user.display_name.slice(0,1).toUpperCase()}</span>}
                <span className="hidden lg:inline text-sm text-[#F5F5F7] max-w-[120px] truncate">{session.user.display_name}</span>
              </Link>
              <form action="/auth/logout" method="post">
                <button aria-label="Sign out" type="submit" className="inline-flex size-8 items-center justify-center rounded-lg text-[#9AA4B8] hover:bg-[#021640] hover:text-[#F5F5F7]"><LogOut className="size-4" /></button>
              </form>
            </div>
          ) : (
            <Button asChild variant="secondary" size="sm">
              <Link href="/login"><User className="size-4" /> Sign in</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Mobile search */}
      <div className="md:hidden border-t border-[#021640] px-4 py-2">
        <form onSubmit={onSearch} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9AA4B8]" />
            <Input aria-label="Search listings" placeholder="Search…" value={q} onChange={(e)=>setQ(e.target.value)} className="pl-9 h-9" />
          </div>
          <Button type="submit" size="sm" variant="primary">Go</Button>
        </form>
      </div>
    </header>
  );
}
