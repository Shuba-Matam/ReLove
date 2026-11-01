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
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-[#03245e] focus:p-3">Skip to content</a>
        <SessionProvider>
          <React.Suspense fallback={<header className="h-14 border-b border-[#021640] bg-[#01071d]" />}>
            <SiteHeader />
          </React.Suspense>
          <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 pb-20 md:pb-6">{children}</main>
          <MobileNav />
          <PwaRegistration />
          <footer className="border-t border-[#021640] bg-[#01071d] px-4 pt-6 pb-24 text-center text-xs leading-6 text-[#9AA4B8] md:pb-6">
            Re-Love student marketplace · Meet in public and check the item before paying.
            <div><Link href="/privacy" className="text-[#82b7ff] underline underline-offset-4">Privacy</Link></div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
