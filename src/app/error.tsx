"use client";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-[#4a102f] bg-[#220815] p-8 text-center">
      <h2 className="text-lg font-semibold text-[#F5F5F7]">Something went wrong</h2>
      <p className="mt-2 text-sm text-[#9AA4B8]">This page is temporarily unavailable. Please check your connection and try again.</p>
      <Button onClick={() => reset()} variant="secondary" className="mt-4">Try again</Button>
    </div>
  );
}
