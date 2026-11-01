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
    <nav aria-label="Listing categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
      {[{ id: "all", slug: "", name: "All finds", icon: "Shapes" }, ...CATEGORIES].map((category) => {
        const active = (current || "") === category.slug;
        return (
          <Link
            key={category.id}
            href={href(category.slug)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition",
              active ? "border-[#03245e] bg-[#03245e] text-white" : "border-[#021640] bg-[#01071d] text-[#9AA4B8] hover:border-[#03245e] hover:bg-[#020102] hover:text-[#F5F5F7]"
            )}
          >
            <CategoryIcon name={category.icon} className="size-3.5" aria-hidden="true" />{category.name}
          </Link>
        );
      })}
    </nav>
  );
}
