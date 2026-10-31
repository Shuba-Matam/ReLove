import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://re-love-pi.vercel.app"),
  title: {
    default: "Re-Love | A second home for student essentials",
    template: "%s | Re-Love",
  },
  description:
    "Re-Love is a student marketplace in development, helping pre-loved books, furniture, and everyday essentials find their next home.",
  openGraph: {
    title: "Re-Love | A second home for student essentials",
    description: "Good things deserve another chapter. A student marketplace, coming soon.",
    siteName: "Re-Love",
    type: "website",
    locale: "en_IN",
  },
};

export const viewport: Viewport = { themeColor: "#020102" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
