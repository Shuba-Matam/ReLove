import type { Metadata, Viewport } from "next";
import * as React from "react";
import "./globals.css";
import { SessionProvider } from "@/lib/client/session";
import { NotificationsProvider } from "@/lib/client/notifications";
import { NotificationToasts } from "@/components/notifications/notification-toasts";
import { SiteHeader } from "@/components/layout/site-header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PwaRegistration } from "./pwa-registration";
import Link from "next/link";

export const metadata: Metadata = {
  metadataBase: new URL("https://re-love-pi.vercel.app"),
  title: "Re-Love | Student marketplace",
  description: "Give pre-loved items a new home. A student marketplace for textbooks, electronics, furniture and more.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Re-Love" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a100c", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#1a100c] text-[#f6ead8] antialiased">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#ead7b7] focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[#241712] focus:outline-none focus:ring-2 focus:ring-[#e6c79c] focus:ring-offset-2 focus:ring-offset-[#1a100c]">Skip to content</a>
        <SessionProvider>
          <NotificationsProvider>
            <React.Suspense fallback={<header className="h-14 border-b border-[#4a3025]/40 bg-[#1a100c]" aria-hidden="true" />}>
              <SiteHeader />
            </React.Suspense>
            <main id="main-content" className="mx-auto min-w-0 max-w-7xl px-4 py-6 pb-24 md:px-5 md:py-8 md:pb-8">{children}</main>
            <MobileNav />
            <NotificationToasts />
            <PwaRegistration />
            <footer className="mt-8 border-t border-[#4a3025]/50 px-4 py-6 pb-24 text-center md:mt-10 md:pb-6">
              <p className="text-xs text-[#bba995]">Re-Love · Meet in public and check items before paying.</p>
              <nav aria-label="Footer" className="mt-1 flex items-center justify-center gap-3">
                <Link
                  href="/privacy"
                  className="text-xs text-[#ead7b7] underline decoration-[#ead7b7]/60 underline-offset-4 hover:text-[#fff0d3] hover:decoration-[#fff0d3]"
                >
                  Privacy
                </Link>
                <span aria-hidden="true" className="text-[#4a3025]">
                  ·
                </span>
                <Link
                  href="/install"
                  className="text-xs text-[#ead7b7] underline decoration-[#ead7b7]/60 underline-offset-4 hover:text-[#fff0d3] hover:decoration-[#fff0d3]"
                >
                  Install
                </Link>
              </nav>
            </footer>
          </NotificationsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
