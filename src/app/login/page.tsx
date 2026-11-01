import Link from "next/link";
import { sanitizeNextPath } from "@/lib/server/http";
import { isAuthConfigured } from "@/lib/server/env";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>>}) {
  const sp = await searchParams;
  const next = sanitizeNextPath(sp.next);
  const configured = isAuthConfigured();
  const loginHref = `/auth/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-8 md:py-12">
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-[17px]">Welcome to Re-Love</CardTitle>
          <CardDescription>Sign in with Google to sell, message, and manage listings. Demo mode is read-only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sp.error && <p role="alert" className="rounded-xl border border-[#4a102f] bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8]">Sign-in could not be completed. Please try again once Google sign-in is available.</p>}
          {!configured && <p className="rounded-xl border border-[#021640] bg-[#020102] p-3 text-sm leading-5 text-[#9AA4B8]">Google sign-in is being connected. You can browse the marketplace while setup is finished.</p>}
          {configured && <a href={loginHref} className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-[#020102] transition hover:bg-[#F5F5F7]">
            <svg viewBox="0 0 24 24" className="size-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </a>}
          <p className="text-center text-xs leading-5 text-[#9AA4B8]">Use a Google account to join. Your email address is never displayed on listings.</p>
          <div className="text-center"><Link href="/" className="text-xs font-medium text-[#82b7ff] underline decoration-[#03245e] underline-offset-4 hover:text-[#93c5fd]">Browse as a guest</Link></div>
        </CardContent>
      </Card>
    </div>
  );
}
