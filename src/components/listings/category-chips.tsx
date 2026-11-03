"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/lib/marketplace";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/category-icon";
export function CategoryChips({ activeSlug }: { activeSlug?: string | null }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const current = activeSlug ?? sp.get("category");
  const href = (slug?: string) => {
    const params = new URLSearchParams(sp.toString());
    if (slug) params.set("category", slug);
    else params.delete("category");
    params.delete("cursor");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <nav aria-label="Listing categories" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
      {[{ id: "all", slug: "", name: "All", icon: "Shapes" }, ...CATEGORIES].map((category) => {
        const active = (current || "") === category.slug;
        return (
          <Link
            key={category.id}
            href={href(category.slug)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a100c]",
              active ? "bg-[#ead7b7] text-[#241712]" : "bg-[#1a100c] text-[#bba995] ring-1 ring-[#4a3025]/60 hover:bg-[#241712] hover:text-[#f6ead8] hover:ring-[#ead7b7]"
            )}
          >
            <CategoryIcon name={category.icon} className="size-3.5" aria-hidden="true" />{category.name}
          </Link>
        );
      })}
    </nav>
  );
}
