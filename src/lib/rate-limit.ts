import "server-only";

/**
 * Fixed-window rate limit per key (the client IP), in memory. The public demo uses it on every
 * endpoint that starts a run. Each server instance counts on its own (on Vercel, per instance).
 */

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiter {
  /** Counts one hit for `key`; ok=false once the key has used up its window. */
  hit(key: string): RateResult;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (v.resetAt <= t) windows.delete(k);
          // Still full (a flood of new addresses): drop the oldest window so memory stays bounded.
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        w = { count: 0, resetAt: t + opts.windowMs };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= opts.limit) return { ok: true };
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
    },
  };
}

/** The client IP as the platform reports it. Vercel sets x-forwarded-for itself, so it cannot be spoofed there. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** DEMO_PUBLIC=1: runs one IP may start per minute. A recorded run lasts 11-37 s, so a visitor can try every scenario. */
export const PUBLIC_RUN_LIMIT = { limit: 10, windowMs: 60_000 } as const;

let runLimiter: RateLimiter | undefined;

/** The limiter for starting runs in the public demo (POST /api/runs). */
export function getRunLimiter(): RateLimiter {
  runLimiter ??= createRateLimiter(PUBLIC_RUN_LIMIT);
  return runLimiter;
}
