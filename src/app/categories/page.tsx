import Link from "next/link";
import { getCategories } from "@/lib/server/queries";
import { CategoryIcon } from "@/components/category-icon";
export default async function CategoriesPage() {
  const { data: categories, mode } = await getCategories();
  return (
    <div className="space-y-6">
      <div className="pb-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#bba995]">Browse</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#f6ead8]">Categories</h1>
        <p className="mt-1 max-w-xl text-sm leading-6 text-[#bba995]">Textbooks, cycles, room essentials and more.</p>
        {mode === "demo" && <p className="mt-2 text-xs text-[#bba995]">Sample preview · read-only</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3">
        {categories.map((category) => (
          <Link key={category.id} href={"/?category=" + category.slug} className="group flex min-h-[132px] flex-col justify-between rounded-xl bg-[#1a100c] p-4 ring-1 ring-[#4a3025]/50 transition hover:ring-[#ead7b7]">
            <CategoryIcon name={category.icon} className="size-6 text-[#ead7b7]" />
            <span className="mt-4 text-[13px] font-medium tracking-tight text-[#f6ead8] group-hover:text-white">{category.name}</span>
          </Link>
        ))}
      </div>
      {!categories.length && <p className="py-8 text-center text-sm text-[#bba995]">Categories are being prepared.</p>}
    </div>
  );
}
