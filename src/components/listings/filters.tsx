"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CONDITIONS, CONDITION_LABELS } from "@/lib/marketplace";
import { CategoryChips } from "@/components/listings/category-chips";
import { SlidersHorizontal } from "lucide-react";

export function Filters({ includeCategories = false }: { includeCategories?: boolean }) { const sp = useSearchParams(); return <FilterForm key={sp.toString()} includeCategories={includeCategories} />; }

function FilterForm({ includeCategories }: { includeCategories: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [condition, setCondition] = React.useState(sp.get("condition") ?? "");
  const [block, setBlock] = React.useState(sp.get("hostel_block") ?? "");
  const [min, setMin] = React.useState(sp.get("min_price") ?? "");
  const [max, setMax] = React.useState(sp.get("max_price") ?? "");
  const [sort, setSort] = React.useState(sp.get("sort") ?? "newest");
  const activeCount = [sp.get("category"), sp.get("condition"), sp.get("hostel_block"), sp.get("min_price"), sp.get("max_price"), sp.get("sort")].filter(Boolean).length;


  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const p = new URLSearchParams(sp.toString());
    const setOrDel = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
    setOrDel("q", q.trim());
    setOrDel("condition", condition);
    setOrDel("hostel_block", block.trim());
    setOrDel("min_price", min);
    setOrDel("max_price", max);
    setOrDel("sort", sort !== "newest" ? sort : "");
    p.delete("cursor");
    router.push(`${pathname}?${p.toString()}`);
  }

  function clear() {
    const p = new URLSearchParams();
    const cat = sp.get("category");
    if (cat) p.set("category", cat);
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <details className="group rounded-2xl bg-[#241712] ring-1 ring-[#4a3025]/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium text-[#f6ead8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-[#ead7b7]" /> Filter {activeCount > 0 && <span className="rounded-full bg-[#ead7b7] px-2 py-0.5 text-[10px] font-semibold text-[#241712]">{activeCount}</span>}</span>
        <span className="text-xs text-[#bba995] group-open:hidden">Show</span><span className="hidden text-xs text-[#bba995] group-open:inline">Hide</span>
      </summary>
      <form onSubmit={apply} className="flex flex-col gap-4 border-t border-[#4a3025]/50 p-4">
      {includeCategories && <CategoryChips />}
      <div className="flex flex-wrap gap-2">
        <div className="min-w-[180px] flex-1">
          <Label htmlFor="f-q" className="sr-only">Search</Label>
          <Input id="f-q" placeholder="Search title or description" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 bg-[#1a100c]" />
        </div>
        <Select id="f-condition" value={condition} onChange={(e) => setCondition(e.target.value)} className="h-9 w-auto min-w-[140px] bg-[#1a100c]" aria-label="Condition">
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
          ))}
        </Select>
        <Input id="f-block" placeholder="Hostel Block / Apartment Name" value={block} onChange={(e) => setBlock(e.target.value)} className="h-9 w-auto min-w-[190px] flex-1 sm:flex-none bg-[#1a100c]" aria-label="Hostel Block / Apartment Name" />
        <Input id="f-min" type="number" min={0} placeholder="Min ₹" value={min} onChange={(e) => setMin(e.target.value)} className="h-9 w-[88px] bg-[#1a100c]" aria-label="Min price" />
        <Input id="f-max" type="number" min={0} placeholder="Max ₹" value={max} onChange={(e) => setMax(e.target.value)} className="h-9 w-[88px] bg-[#1a100c]" aria-label="Max price" />
        <Select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 w-auto min-w-[150px] bg-[#1a100c]" aria-label="Sort">
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low→high</option>
          <option value="price_desc">Price: high→low</option>
        </Select>
        <div className="flex items-center gap-1.5">
          <Button type="submit" variant="primary" size="sm" className="h-9">Apply</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clear}>Clear</Button>
        </div>
      </div>
      </form>
    </details>
  );
}
