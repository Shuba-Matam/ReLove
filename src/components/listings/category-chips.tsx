"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/category-icon";
export function CategoryChips({ activeSlug }: { activeSlug?: string | null }) {
 const sp = useSearchParams(); const pathname = usePathname(); const current = activeSlug ?? sp.get("category");
 const href = (slug?: string) => { const params = new URLSearchParams(sp); if(slug) params.set("category",slug); else params.delete("category"); params.delete("cursor"); return pathname + "?" + params.toString(); };
 return <nav aria-label="Listing categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">{[{ id:"all", slug:"", name:"All finds", icon:"Shapes" },...CATEGORIES].map((category) => <Link key={category.id} href={href(category.slug)} aria-current={(current || "") === category.slug ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition",(current || "") === category.slug ? "border-[#4b76b4] bg-[#03245e] text-white" : "border-[#021640] bg-[#01071d] text-[#9AA4B8] hover:text-white")}><CategoryIcon name={category.icon} className="size-4" />{category.name}</Link>)}</nav>;
}
