"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CONDITIONS, CONDITION_LABELS } from "@/lib/marketplace";

export function Filters() { const sp = useSearchParams(); return <FilterForm key={sp.toString()} />; }

function FilterForm() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [condition, setCondition] = React.useState(sp.get("condition") ?? "");
  const [block, setBlock] = React.useState(sp.get("hostel_block") ?? "");
  const [min, setMin] = React.useState(sp.get("min_price") ?? "");
  const [max, setMax] = React.useState(sp.get("max_price") ?? "");
  const [sort, setSort] = React.useState(sp.get("sort") ?? "newest");


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
    <form onSubmit={apply} className="rounded-xl border border-[#021640] bg-[#01071d] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Label htmlFor="f-q">Search</Label>
          <Input id="f-q" placeholder="Title or description" value={q} onChange={(e) => setQ(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="f-condition">Condition</Label>
          <Select id="f-condition" value={condition} onChange={(e) => setCondition(e.target.value)} className="mt-1">
            <option value="">Any condition</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-block">Hostel block</Label>
          <Input id="f-block" placeholder="e.g. A Block" value={block} onChange={(e) => setBlock(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="f-min">Min price</Label>
          <Input id="f-min" type="number" min={0} placeholder="0" value={min} onChange={(e) => setMin(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="f-max">Max price</Label>
          <Input id="f-max" type="number" min={0} placeholder="Any" value={max} onChange={(e) => setMax(e.target.value)} className="mt-1" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Label htmlFor="f-sort" className="mr-1">Sort</Label>
        <Select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto min-w-[160px]">
          <option value="newest">Newest first</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </Select>
        <Button type="submit" variant="primary" size="sm" className="ml-auto">Apply filters</Button>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>Clear</Button>
      </div>
    </form>
  );
}
