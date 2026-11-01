import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-3xl font-semibold text-[#F5F5F7]">Page not found</h1>
      <p className="mt-2 text-sm text-[#9AA4B8]">The page you are looking for does not exist or has been moved.</p>
      <Button asChild variant="primary" className="mt-6"><Link href="/">Back to home</Link></Button>
    </div>
  );
}
