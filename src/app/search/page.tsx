import * as React from "react";
import { SearchClient } from "@/components/search/search-client";

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="rounded-xl border border-[#021640] bg-[#01071d] p-8 text-sm text-[#9AA4B8]">Loading search…</div>}>
      <SearchClient />
    </React.Suspense>
  );
}
