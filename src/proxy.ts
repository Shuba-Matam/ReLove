import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (process.env.APP_MODE === "demo" || process.env.APP_MODE === "setup" || !supabaseUrl || !supabaseKey || !request.cookies.getAll().some(({ name }) => name.startsWith("sb-"))) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/" },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(8000) }) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refresh session via verified getUser; this also updates cookies if needed
  // Use getClaims if available for lightweight, but getUser is verified
  try {
    const { data } = await supabase.auth.getClaims();
    void data;
    // Fallback to getUser to ensure refresh? getClaims already verifies JWT
    // We intentionally do not block request on auth failure
  } catch {
    try {
      await supabase.auth.getUser();
    } catch {
      // ignore
    }
  }

  supabaseResponse.headers.set("Cache-Control", "private, no-store");
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets (icons, offline shell, etc.)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
