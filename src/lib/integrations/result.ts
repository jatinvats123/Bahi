import type { z } from "zod";
import type { ExecError } from "../swytch/errors";

/**
 * What every adapter method returns. Adapters never throw for provider failures;
 * the agent (phase 3) reads `error.kind` to decide what to do next.
 */
export type Outcome<T> = { ok: true; value: T; ms: number } | { ok: false; error: ExecError; ms: number };

export function success<T>(value: T, ms = 0): Outcome<T> {
  return { ok: true, value, ms };
}

export function failure<T>(error: ExecError, ms = 0): Outcome<T> {
  return { ok: false, error, ms };
}

/** Parse provider JSON into a domain value; a shape mismatch becomes a provider error. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown, what: string, ms = 0): Outcome<z.infer<S>> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return success(parsed.data, ms);
  const issue = parsed.error.issues[0];
  return failure(
    {
      kind: "provider",
      message: `Unexpected ${what} response${issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""}`,
    },
    ms,
  );
}

/** Chain: run `next` only when `o` succeeded, adding up the time. */
export async function andThen<A, B>(o: Outcome<A>, next: (value: A) => Promise<Outcome<B>> | Outcome<B>): Promise<Outcome<B>> {
  if (!o.ok) return o;
  const r = await next(o.value);
  return { ...r, ms: r.ms + o.ms };
}
