import * as React from "react";
import { SearchClient } from "@/components/search/search-client";

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="rounded-xl border border-[#4a3025] bg-[#241712] p-8 text-sm text-[#bba995]">Loading search…</div>}>
      <SearchClient />
    </React.Suspense>
  );
}
