/**
 * Guard: kill switch, atomic caps, timeout 20s, max TWO retries total (incl bad JSON retry),
 * manual fallback messages. Reservations count even when provider error/timeout occurs.
 * All provider attempts reserve via DB RPC reserve_ai_usage (FOR UPDATE on ai_budget).
 */
export class AiFailure extends Error {
  constructor(public code: string, message: string, public status = 503, public retryable = false) { super(message); this.name = "AiFailure"; }
}

export interface UsageLedger {
  reserve(): Promise<{ allowed: boolean; usageId: string | null; reason?: string | null }>;
  complete(usageId: string, ok: boolean, ms: number): Promise<void>;
}

export async function runGuardedAi<T>(options: {
  enabled: boolean; ledger: UsageLedger; operation: (signal: AbortSignal, attempt: number) => Promise<T>;
  maxRetries?: number; timeoutMs?: number;
}): Promise<T> {
  if (!options.enabled) throw new AiFailure("AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  const retries = Math.min(2, Math.max(0, options.maxRetries ?? 2));
  const deadline = Date.now() + Math.min(20000, options.timeoutMs ?? 20000);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.");
    const reservation = await options.ledger.reserve();
    if (!reservation.allowed || !reservation.usageId) throw new AiFailure("AI_LIMIT", "AI has reached its usage limit. You can still post manually.", 429);
    const started = Date.now(); let ok = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.")); }, Math.max(1, deadline - Date.now()));
      });
      const result = await Promise.race([options.operation(controller.signal, attempt), timeout]);
      ok = true;
      return result;
    } catch (error) {
      const failure = error instanceof AiFailure ? error : new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, true);
      if (!failure.retryable || attempt === retries || Date.now() >= deadline) throw failure;
    } finally {
      clearTimeout(timer);
      // Reservations count even when a timeout, provider error, or process failure occurs.
      await options.ledger.complete(reservation.usageId, ok, Math.min(60000,Date.now() - started)).catch(() => undefined);
    }
  }
  throw new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. Continue manually.");
}
