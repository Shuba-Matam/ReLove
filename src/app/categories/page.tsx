import Link from "next/link";
import { getCategories } from "@/lib/server/queries";
import { CategoryIcon } from "@/components/category-icon";
export default async function CategoriesPage() {
  const { data: categories, mode } = await getCategories();
  return (
    <div className="space-y-6">
      <div className="pb-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9AA4B8]">Browse</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#F5F5F7]">Categories</h1>
        <p className="mt-1 max-w-xl text-sm leading-6 text-[#9AA4B8]">Textbooks, cycles, room essentials and more.</p>
        {mode === "demo" && <p className="mt-2 text-xs text-[#9AA4B8]">Sample preview · read-only</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3">
        {categories.map((category) => (
          <Link key={category.id} href={"/?category=" + category.slug} className="group flex min-h-[132px] flex-col justify-between rounded-xl bg-[#020102] p-4 ring-1 ring-[#021640]/50 transition hover:ring-[#03245e]">
            <CategoryIcon name={category.icon} className="size-6 text-[#82b7ff]" />
            <span className="mt-4 text-[13px] font-medium tracking-tight text-[#F5F5F7] group-hover:text-white">{category.name}</span>
          </Link>
        ))}
      </div>
      {!categories.length && <p className="py-8 text-center text-sm text-[#9AA4B8]">Categories are being prepared.</p>}
    </div>
  );
}
