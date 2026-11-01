import Link from "next/link";
import { getCategories } from "@/lib/server/queries";
import { CategoryIcon } from "@/components/category-icon";
export default async function CategoriesPage() {
 const { data: categories, mode } = await getCategories();
 return <div className="space-y-6"><div><h1 className="text-3xl font-semibold tracking-tight">A little bit of everything.</h1><p className="mt-2 text-sm text-[#9AA4B8]">Find a new home for what you have. Find what you need.</p></div>{mode === "demo" && <p className="text-xs text-[#9AA4B8]">Sample categories · read-only preview</p>}<div className="grid grid-cols-2 gap-4 md:grid-cols-4">{categories.map((category) => <Link key={category.id} href={"/?category=" + category.slug} className="group flex min-h-44 flex-col justify-between rounded-2xl border border-[#021640] bg-[#01071d] p-6 transition hover:border-[#4b76b4]"><CategoryIcon name={category.icon} className="size-8 text-[#82b7ff]" /><span className="mt-6 font-medium">{category.name}</span></Link>)}</div>{!categories.length && <p className="text-sm text-[#9AA4B8]">Categories are being prepared.</p>}</div>;
}
