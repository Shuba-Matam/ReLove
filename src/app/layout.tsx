import type { Metadata, Viewport } from "next";
import * as React from "react";
import "./globals.css";
import { SessionProvider } from "@/lib/client/session";
import { SiteHeader } from "@/components/layout/site-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PwaRegistration } from "./pwa-registration";
import Link from "next/link";

export const metadata: Metadata = {
  metadataBase: new URL("https://re-love-pi.vercel.app"),
  title: "Re-Love — Student marketplace",
  description: "Give pre-loved items a new home. A student marketplace for textbooks, electronics, furniture and more.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Re-Love" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#020102", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#020102] text-[#F5F5F7] antialiased">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#03245e] focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus:ring-2 focus:ring-[#60a5fa] focus:ring-offset-2 focus:ring-offset-[#020102]">Skip to content</a>
        <SessionProvider>
          <React.Suspense fallback={<header className="h-14 border-b border-[#021640]/40 bg-[#020102]" aria-hidden="true" />}>
            <SiteHeader />
          </React.Suspense>
          <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 pb-24 md:px-5 md:py-8 md:pb-8">{children}</main>
          <MobileNav />
          <PwaRegistration />
          <footer className="mt-8 border-t border-[#021640]/50 px-4 py-6 pb-24 text-center md:mt-10 md:pb-6">
            <p className="text-xs text-[#9AA4B8]">Re-Love · Meet in public and check items before paying.</p>
            <Link href="/privacy" className="mt-1 inline-block text-xs text-[#82b7ff] underline decoration-[#03245e]/60 underline-offset-4 hover:text-[#93c5fd] hover:decoration-[#93c5fd]">
              Privacy
            </Link>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
