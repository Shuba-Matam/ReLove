import Link from "next/link";
import { getCategories } from "@/lib/server/queries";
import { CategoryIcon } from "@/components/category-icon";
export default async function CategoriesPage() {
  const { data: categories, mode } = await getCategories();
  return (
    <div className="space-y-6">
      <div className="border-b border-[#021640] pb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#9AA4B8]">Browse</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#F5F5F7]">A little bit of everything.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#9AA4B8]">Find a new home for what you have. Find what you need — textbooks, bikes, room essentials and more.</p>
        {mode === "demo" && <p className="mt-3 text-xs text-[#9AA4B8]">Sample categories · read-only preview</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {categories.map((category) => (
          <Link key={category.id} href={"/?category=" + category.slug} className="group flex min-h-[168px] flex-col justify-between rounded-2xl border border-[#021640] bg-[#01071d] p-5 transition hover:border-[#03245e] hover:bg-[#020102]">
            <CategoryIcon name={category.icon} className="size-7 text-[#82b7ff]" />
            <span className="mt-6 text-[14px] font-medium tracking-tight text-[#F5F5F7] group-hover:text-white">{category.name}</span>
          </Link>
        ))}
      </div>
      {!categories.length && <p className="rounded-2xl border border-dashed border-[#021640] bg-[#01071d] p-8 text-center text-sm text-[#9AA4B8]">Categories are being prepared.</p>}
    </div>
  );
}
