/**
 * Guard: kill switch, atomic caps, timeout 20s fail-closed, max TWO retries total (incl bad JSON retry),
 * manual fallback messages. Reservations count even when provider error/timeout occurs.
 * All provider attempts reserve via DB RPC reserve_ai_attempt (FOR UPDATE on ai_budget).
 *
 * Hardenings:
 * - Deadline is fail-closed: no attempt starts or retries past deadline; abort signal fired on timeout.
 *   Reserve wait is bounded; if reserve consumes deadline, provider is not started and reserved failure recorded.
 * - Non-retryable: 401 credentials, 402 payment, 403 forbidden, 400 invalid, 413 too large never retry.
 * - 429 rate-limit and 5xx are retryable but bounded to 2 retries, deadline, and delayed 429 only if enough time.
 * - Bounded output/image/audio enforced in provider/routes; listing-only AI (no search/messages).
 * - Drafts+voice occur BEFORE publish; each regenerate/retry incurs a counted call.
 * - Current per-day caps do NOT guarantee credits survive across days; see docs/AI-BUDGET-PROPOSAL.md.
 */
export class AiFailure extends Error {
  constructor(public code: string, message: string, public status = 503, public retryable = false) {
    super(message);
    this.name = "AiFailure";
  }
}

export interface MeteredLedger {
  reserve(): Promise<import("./meter").MeterReserveResult>;
  complete(attemptId: string, ok: boolean, ms: number, result?: unknown): Promise<void>;
}

const NON_RETRYABLE = new Set(["AI_CREDENTIALS", "AI_PAYMENT", "AI_FORBIDDEN", "AI_SIZE", "AI_INVALID", "AI_LIMIT", "AI_DISABLED", "AI_QUOTA"]);

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LEDGER_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export type GuardedResult<T> = { status: "fresh"; value: T } | { status: "duplicate_done"; cached: unknown } | { status: "duplicate_pending" };

export async function runMeteredGuarded<T>(options: {
  ledger: MeteredLedger;
  operation: (signal: AbortSignal, attempt: number) => Promise<T>;
  validateCached?: (cached: unknown) => T | null;
  maxRetries?: number;
  timeoutMs?: number;
}): Promise<GuardedResult<T>> {
  const retries = Math.min(2, Math.max(0, options.maxRetries ?? 2));
  const deadline = Date.now() + Math.min(20000, options.timeoutMs ?? 20000);

  for (let attempt = 0; attempt <= retries; attempt++) {
    let remaining = deadline - Date.now();
    if (remaining <= 0) throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false);

    let reservation: import("./meter").MeterReserveResult;
    try {
      reservation = await bounded(options.ledger.reserve(), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("AI_METERING_MALFORMED")) throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.", 503, false);
      if (msg.includes("AI_RESERVE_TIMEOUT") || msg.includes("LEDGER_TIMEOUT")) throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.", 503, false);
      throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.", 503, false);
    }

    // Typed duplicate handling: no exception-as-HTTP200, no provider call
    if (!reservation.allowed) {
      if (reservation.disposition === "duplicate_done") {
        // Validate cached JSON per feature; malformed cached rejects as unavailable, not raw Buffer
        const cached = reservation.cachedResult;
        if (options.validateCached) {
          try {
            const validated = options.validateCached(cached);
            if (validated !== null && validated !== undefined) return { status: "duplicate_done", cached: validated };
            // If validation fails, treat as unavailable (don't return raw)
            throw new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, false);
          } catch {
            throw new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, false);
          }
        }
        return { status: "duplicate_done", cached };
      }
      if (reservation.disposition === "duplicate_pending") {
        return { status: "duplicate_pending" };
      }
      const reason = reservation.reason ?? "unknown";
      if (reason === "disabled" || reason === "invalid_limits" || reason === "budget_unconfigured" || reason === "feature_disabled" || reason === "unpriced_feature") {
        throw new AiFailure("AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.", 503, false);
      }
      // budget_exhausted, global_limit, user_limit, max_attempts, source_mismatch etc. are limits
      throw new AiFailure("AI_LIMIT", "AI has reached its usage limit. You can still post manually.", 429, false);
    }

    // Fresh attempt: must have attemptId+operationId+executed
    const attemptId = reservation.attemptId;
    const operationId = reservation.operationId;
    if (!attemptId || !operationId || reservation.disposition !== "executed") {
      throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.", 503, false);
    }

    remaining = deadline - Date.now();
    if (remaining <= 0) {
      await bounded(options.ledger.complete(attemptId, false, 0), 2500).catch(() => undefined);
      throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false);
    }

    const started = Date.now();
    let ok = false;
    let resultValue: T | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        const ms = Math.max(1, deadline - Date.now());
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false));
        }, ms);
      });
      const result = await Promise.race([options.operation(controller.signal, attempt), timeout]);
      ok = true;
      resultValue = result;
      return { status: "fresh", value: result };
    } catch (error) {
      const failure = error instanceof AiFailure ? error : new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, true);
      if (timedOut) throw failure;
      const pastDeadline = Date.now() >= deadline;
      if (NON_RETRYABLE.has(failure.code) || !failure.retryable) throw failure;
      if (attempt === retries || pastDeadline) throw failure;
      if (failure.code === "AI_RATE_LIMIT") {
        const need = 400;
        if (deadline - Date.now() < need) throw failure;
        await new Promise((r) => setTimeout(r, 200));
        if (Date.now() >= deadline) throw failure;
      }
      // Retry will loop and reserve again (separate attempt, counts toward max3)
      continue;
    } finally {
      clearTimeout(timer);
      await bounded(options.ledger.complete(attemptId, ok, Math.min(60000, Date.now() - started), ok ? resultValue : undefined), 2500).catch(() => undefined);
    }
  }
  throw new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. Continue manually.", 503, false);
}

// Legacy helper for tests that still use simple ledger without metering
export interface SimpleLedger {
  reserve(): Promise<{ allowed: boolean; usageId: string | null; reason?: string | null }>;
  complete(usageId: string, ok: boolean, ms: number): Promise<void>;
}
export type UsageLedger = SimpleLedger;

export async function runGuardedAi<T>(options: { enabled: boolean; ledger: SimpleLedger; operation: (signal: AbortSignal, attempt: number) => Promise<T>; maxRetries?: number; timeoutMs?: number }): Promise<T> {
  if (!options.enabled) throw new AiFailure("AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.");
  const retries = Math.min(2, Math.max(0, options.maxRetries ?? 2));
  const deadline = Date.now() + Math.min(20000, options.timeoutMs ?? 20000);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let remaining = deadline - Date.now();
    if (remaining <= 0) throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false);
    let reservation: { allowed: boolean; usageId: string | null; reason?: string | null } | null = null;
    try {
      reservation = await bounded(options.ledger.reserve(), 4000);
    } catch {
      throw new AiFailure("AI_LIMIT_UNAVAILABLE", "AI usage checks are unavailable. Continue manually.", 503, false);
    }
    if (!reservation.allowed || !reservation.usageId) {
      const reason = reservation.reason ?? "unknown";
      if (reason === "disabled" || reason === "invalid_limits" || reason === "budget_unconfigured" || reason === "feature_disabled")
        throw new AiFailure("AI_DISABLED", "AI assistance is off. You can fill in the listing yourself.", 503, false);
      throw new AiFailure("AI_LIMIT", "AI has reached its usage limit. You can still post manually.", 429, false);
    }
    remaining = deadline - Date.now();
    if (remaining <= 0) {
      await bounded(options.ledger.complete(reservation.usageId, false, 0), 2500).catch(() => undefined);
      throw new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false);
    }
    const started = Date.now();
    let ok = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        const ms = Math.max(1, deadline - Date.now());
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new AiFailure("AI_TIMEOUT", "AI took too long. Continue with the manual form.", 503, false));
        }, ms);
      });
      const result = await Promise.race([options.operation(controller.signal, attempt), timeout]);
      ok = true;
      return result;
    } catch (error) {
      const failure = error instanceof AiFailure ? error : new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. You can continue manually.", 503, true);
      if (timedOut) throw failure;
      const pastDeadline = Date.now() >= deadline;
      if (NON_RETRYABLE.has(failure.code) || !failure.retryable) throw failure;
      if (attempt === retries || pastDeadline) throw failure;
      if (failure.code === "AI_RATE_LIMIT") {
        const need = 400;
        if (deadline - Date.now() < need) throw failure;
        await new Promise((r) => setTimeout(r, 200));
        if (Date.now() >= deadline) throw failure;
      }
    } finally {
      clearTimeout(timer);
      await bounded(options.ledger.complete(reservation.usageId, ok, Math.min(60000, Date.now() - started)), 2500).catch(() => undefined);
    }
  }
  throw new AiFailure("AI_UNAVAILABLE", "AI assistance is unavailable. Continue manually.", 503, false);
}
