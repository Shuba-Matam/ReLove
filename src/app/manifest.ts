import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Re-Love · Campus marketplace", short_name: "Re-Love",
    description: "Give pre-loved things a new chapter on campus.",
    start_url: "/", scope: "/", display: "standalone",
    background_color: "#020102", theme_color: "#020102",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
