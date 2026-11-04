"use client";

import * as React from "react";

export type AiUsageFeature = "draft" | "transcribe" | "cutout";

export type AiUsage = {
  feature: AiUsageFeature;
  remaining: number;
  limit: number;
  used: number;
  resets_at: string;
  available: boolean;
  unavailability: "account_limit" | "shared_limit" | "feature_limit" | "provider_budget" | "disabled" | null;
};

type LoadResult =
  | { status: "success"; owner: string; usage: AiUsage }
  | { status: "error"; owner: string }
  | { status: "cleared" }
  | { status: "stale" };

const AI_USAGE_INVALIDATED_EVENT = "re-love:ai-usage-invalidated";
const USAGE_FETCH_TIMEOUT_MS = 8_000;

export class AiUsageRequestManager {
  private owner: string | null = null;
  private generation = 0;
  private controller: AbortController | null = null;
  private active = true;

  constructor(
    private readonly fetcher: typeof fetch,
    private readonly timeoutMs = USAGE_FETCH_TIMEOUT_MS,
  ) {}

  activate() {
    this.active = true;
  }

  setOwner(userId: string | null | undefined) {
    const nextOwner = userId ?? null;
    if (nextOwner === this.owner) return;
    this.owner = nextOwner;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  async load(userId: string | null | undefined, feature: AiUsageFeature): Promise<LoadResult> {
    const owner = userId ?? null;
    if (!owner) return { status: "cleared" };
    if (owner !== this.owner) return { status: "stale" };

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(`/api/ai/usage?feature=${encodeURIComponent(feature)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await response.json();
      if (!response.ok) throw new Error("usage unavailable");
      if (!this.active || generation !== this.generation || owner !== this.owner) return { status: "stale" };
      return { status: "success", owner, usage: (json.data ?? json) as AiUsage };
    } catch {
      if (!this.active || generation !== this.generation || owner !== this.owner) return { status: "stale" };
      return { status: "error", owner };
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose() {
    this.active = false;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
}

export function nextUtcResetDelay(now = new Date()) {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1_000, reset - now.getTime() + 1_000);
}

export function invalidateAiUsage() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_USAGE_INVALIDATED_EVENT));
}

export function useAiUsage(userId: string | null | undefined, feature: AiUsageFeature = "draft") {
  const normalizedUserId = userId ?? null;
  const [state, setState] = React.useState<{ owner: string | null; usage: AiUsage | null; unavailable: boolean }>({ owner: null, usage: null, unavailable: false });
  const [manager] = React.useState(() => new AiUsageRequestManager(fetch));
  const mountedRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    const result = await manager.load(normalizedUserId, feature);
    if (!mountedRef.current || result.status === "stale") return;
    if (result.status === "cleared") {
      setState({ owner: null, usage: null, unavailable: false });
    } else if (result.status === "error") {
      setState({ owner: result.owner, usage: null, unavailable: true });
    } else {
      setState({ owner: result.owner, usage: result.usage, unavailable: false });
    }
  }, [feature, manager, normalizedUserId]);

  React.useLayoutEffect(() => {
    manager.activate();
    manager.setOwner(normalizedUserId);
  }, [manager, normalizedUserId]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      manager.dispose();
    };
  }, [manager]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  React.useEffect(() => {
    if (!normalizedUserId) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    window.addEventListener(AI_USAGE_INVALIDATED_EVENT, refreshWhenActive);
    let resetTimer = 0;
    const scheduleUtcReset = () => {
      resetTimer = window.setTimeout(() => {
        void refresh();
        scheduleUtcReset();
      }, nextUtcResetDelay());
    };
    scheduleUtcReset();
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      window.removeEventListener(AI_USAGE_INVALIDATED_EVENT, refreshWhenActive);
      window.clearTimeout(resetTimer);
    };
  }, [normalizedUserId, refresh, state.usage?.resets_at]);

  const ownsVisibleState = state.owner === normalizedUserId;
  return {
    usage: ownsVisibleState ? state.usage : null,
    unavailable: ownsVisibleState ? state.unavailable : false,
    refresh,
  };
}

const FEATURE_LABELS: Record<AiUsageFeature, string> = {
  draft: "suggestions",
  transcribe: "voice transcription",
  cutout: "cutouts",
};

export function aiUsageMessage(usage: AiUsage | null, unavailable: boolean): string | null {
  if (unavailable) return "AI try availability is unavailable right now.";
  if (!usage) return null;
  const label = FEATURE_LABELS[usage.feature];
  const count = `${usage.remaining} of ${usage.limit} shared account AI tries remain today for ${label}.`;
  if (usage.unavailability === "shared_limit") return `${count} The shared app limit has been reached.`;
  if (usage.unavailability === "feature_limit") return `${count} This feature has reached its limit.`;
  if (usage.unavailability === "provider_budget") return `${count} This feature is temporarily unavailable.`;
  if (usage.unavailability === "disabled") return `${label[0].toUpperCase()}${label.slice(1)} are unavailable.`;
  return `${count} Attempts from every AI feature count toward this allowance.`;
}
