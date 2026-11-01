"use client";
import * as React from "react";
import type { SessionInfo } from "@/lib/marketplace";
import { fetchSession } from "./api";

type Ctx = {
  session: SessionInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = React.createContext<Ctx>({ session: null, loading: true, refresh: async () => {} });

export function SessionProvider({ children, initial }: { children: React.ReactNode; initial?: SessionInfo | null }) {
  const [session, setSession] = React.useState<SessionInfo | null>(initial ?? null);
  const [loading, setLoading] = React.useState(!initial);

  const refresh = React.useCallback(async () => {
    const s = await fetchSession();
    setSession(s);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    let active = true;
    if (!initial) fetchSession().then((s) => { if (active) { setSession(s); setLoading(false); } });
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { active = false; window.removeEventListener("focus", focus); };
  }, [initial, refresh]);

  return <SessionContext.Provider value={{ session, loading, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return React.useContext(SessionContext);
}
