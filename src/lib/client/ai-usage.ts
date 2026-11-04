"use client";

import * as React from "react";

export type AiUsage = {
  remaining: number;
  limit: number;
  used: number;
  resets_at: string;
  available: boolean;
  unavailability: "account_limit" | "shared_limit" | "feature_limit" | "provider_budget" | "disabled" | null;
};

export function useAiUsage(userId: string | null | undefined) {
  const [usage, setUsage] = React.useState<AiUsage | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const requestRef = React.useRef(0);
  const ownerRef = React.useRef<string | null | undefined>(undefined);

  const refresh = React.useCallback(async () => {
    if (!userId) {
      ownerRef.current = userId;
      setUsage(null);
      setUnavailable(false);
      return;
    }
    if (ownerRef.current !== userId) {
      ownerRef.current = userId;
      setUsage(null);
      setUnavailable(false);
    }
    const request = ++requestRef.current;
    try {
      const response = await fetch("/api/ai/usage", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error("usage unavailable");
      if (request === requestRef.current) {
        setUsage((json.data ?? json) as AiUsage);
        setUnavailable(false);
      }
    } catch {
      if (request === requestRef.current) {
        setUsage(null);
        setUnavailable(true);
      }
    }
  }, [userId]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return { usage, unavailable, refresh };
}

export function aiUsageMessage(usage: AiUsage | null, unavailable: boolean): string | null {
  if (unavailable) return "AI tries remaining are unavailable right now.";
  if (!usage) return null;
  const count = `${usage.remaining} of ${usage.limit} AI tries remaining today.`;
  if (usage.unavailability === "shared_limit" || usage.unavailability === "feature_limit") return `${count} Suggestions are temporarily unavailable due to a shared limit.`;
  if (usage.unavailability === "provider_budget") return `${count} Suggestions are temporarily unavailable.`;
  if (usage.unavailability === "disabled") return "AI suggestions are unavailable.";
  return count;
}
