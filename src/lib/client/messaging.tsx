"use client";

import * as React from "react";
import { useSession } from "@/lib/client/session";
import { MessagingRealtimeController, type MessagingConnection, type MessagingEvent } from "@/lib/client/messaging-realtime";

type Context = { status: MessagingConnection; subscribe: (listener: (event: MessagingEvent) => void) => () => void };
const MessagingContext = React.createContext<Context>({ status: "idle", subscribe: () => () => {} });

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const userId = session?.mode === "live" ? session.user?.id ?? null : null;
  const [controller] = React.useState(() => new MessagingRealtimeController());
  const [status, setStatus] = React.useState<MessagingConnection>("idle");
  React.useEffect(() => controller.subscribe((event) => { if (event.kind === "connection") setStatus(event.status); }), [controller]);
  React.useEffect(() => {
    if (userId) void controller.connect(userId); else controller.disconnect();
    return () => controller.disconnect();
  }, [controller,userId]);
  const subscribe = React.useCallback((listener: (event: MessagingEvent) => void) => controller.subscribe(listener), [controller]);
  return <MessagingContext.Provider value={{ status, subscribe }}>{children}</MessagingContext.Provider>;
}

export function useMessaging() { return React.useContext(MessagingContext); }
