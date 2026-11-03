import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-[#f6ead8]">Page not found</h1>
      <p className="mt-2 text-sm leading-6 text-[#bba995]">That page does not exist or has moved.</p>
      <Button asChild variant="primary" size="sm" className="mt-5"><Link href="/">Back to home</Link></Button>
    </div>
  );
}
