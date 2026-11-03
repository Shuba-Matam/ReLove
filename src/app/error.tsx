"use client";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl bg-[#32171a] p-8 text-center ring-1 ring-[#6b3434]">
      <h2 className="text-base font-semibold tracking-tight text-[#f6ead8]">Something went wrong</h2>
      <p className="mt-2 text-sm leading-6 text-[#bba995]">Please check your connection and try again.</p>
      <Button onClick={() => reset()} variant="secondary" size="sm" className="mt-4">Try again</Button>
    </div>
  );
}
