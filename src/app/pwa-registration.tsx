"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaRegistration() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* App remains fully usable without installation. */ });
    }
    const ready = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const installed = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", installed); };
  }, []);
  if (!install) return null;
  return <aside className="fixed bottom-24 right-4 z-40 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-[#4a3025] bg-[#241712] p-3 shadow-xl md:bottom-5" aria-label="Install Re-Love">
    <button className="rounded-full bg-[#ead7b7] px-4 py-2 text-sm font-medium text-[#241712] focus-visible:outline-2 focus-visible:outline-[#e6c79c]" onClick={async () => { try { await install.prompt(); await install.userChoice; } finally { setInstall(null); } }}>Install Re-Love</button>
    <button onClick={() => setInstall(null)} className="px-2 py-2 text-sm text-[#bba995]" aria-label="Dismiss install prompt">Later</button>
  </aside>;
}
