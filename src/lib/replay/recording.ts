import { z } from "zod";
import { RunEventSchema, type RunEvent } from "../events";
import { SCENARIO_IDS } from "../scenarios";

/**
 * Recorded runs for replay mode (AGENT_MODE=replay): real live runs of S1-S6, sanitized and
 * saved as fixtures/runs/<scenario>.ndjson (one RunEvent per line) with fixtures/runs/index.json.
 * Pure module: the recorder script, the replay route and the tests share it.
 */

export const RecordingMetaSchema = z.object({
  scenario: z.enum(SCENARIO_IDS),
  file: z.string().regex(/^[A-Za-z0-9-]+\.ndjson$/),
  command: z.string(),
  status: z.string(),
  recordedAt: z.iso.datetime({ offset: true }),
  sourceRunId: z.string(),
  mode: z.enum(["live", "mock"]),
  events: z.number().int().positive(),
});
export type RecordingMeta = z.infer<typeof RecordingMetaSchema>;

export const RecordingIndexSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  recordings: z.array(RecordingMetaSchema),
});
export type RecordingIndex = z.infer<typeof RecordingIndexSchema>;

export interface Recording {
  meta: RecordingMeta;
  events: RunEvent[];
}

// ---------------------------------------------------------------- sanitizing

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAYPAL_INV_RE = /\bINV2(?:-[A-Z0-9]{4}){4}\b/g;
/** Gmail message ids (16 hex). Bahi intent keys ("bahi-<16 hex>") are hashes and stay. */
const GMAIL_ID_RE = /(?<!bahi-)\b[0-9a-f]{16}\b/g;

/**
 * Shared across all recordings in one pass, so the same real invoice id becomes the same
 * placeholder in S3, S4 and S6 (the replays stay consistent with each other).
 */
export interface SanitizeContext {
  /** Real address (lower-case) -> placeholder address. Anything else that is not *.example is replaced. */
  emails: Map<string, string>;
  invoices: Map<string, string>;
  messages: Map<string, string>;
}

export function createSanitizeContext(emails: Iterable<[string, string]> = []): SanitizeContext {
  return { emails: new Map([...emails].map(([k, v]) => [k.toLowerCase(), v])), invoices: new Map(), messages: new Map() };
}

function placeholderInvoice(ctx: SanitizeContext, id: string): string {
  let p = ctx.invoices.get(id);
  if (!p) {
    p = `INV2-DEMO-${String(ctx.invoices.size + 1).padStart(4, "0")}-BAHI-RPLY`;
    ctx.invoices.set(id, p);
  }
  return p;
}

export function sanitizeText(ctx: SanitizeContext, text: string): string {
  return text
    .replace(EMAIL_RE, (m) => {
      const known = ctx.emails.get(m.toLowerCase());
      if (known) return known;
      if (/\.example$/i.test(m)) return m;
      let p = ctx.emails.get(`other:${m.toLowerCase()}`);
      if (!p) {
        p = `someone${ctx.emails.size + 1}@example.com`;
        ctx.emails.set(`other:${m.toLowerCase()}`, p);
      }
      return p;
    })
    .replace(PAYPAL_INV_RE, (m) => placeholderInvoice(ctx, m))
    .replace(GMAIL_ID_RE, (m) => {
      let p = ctx.messages.get(m);
      if (!p) {
        p = `msg-${String(ctx.messages.size + 1).padStart(3, "0")}`;
        ctx.messages.set(m, p);
      }
      return p;
    });
}

function walk(ctx: SanitizeContext, v: unknown): unknown {
  if (typeof v === "string") return sanitizeText(ctx, v);
  if (Array.isArray(v)) return v.map((x) => walk(ctx, x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(ctx, x)]));
  return v;
}

/**
 * A stored run -> recording events: heartbeats dropped (keep-alives only), seq renumbered 1..n,
 * runId neutral, and every string scrubbed of real emails, PayPal invoice ids and Gmail ids.
 * Timestamps are kept: playback timing is derived from them.
 */
export function sanitizeRunEvents(ctx: SanitizeContext, events: readonly RunEvent[], runId: string): RunEvent[] {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => e.type !== "heartbeat")
    .map((e, i) => RunEventSchema.parse({ ...(walk(ctx, e) as RunEvent), runId, seq: i + 1, ts: e.ts }));
}

/** Leftovers that must never be committed: any address outside *.example, any real-looking PayPal id. */
export function findLeaks(events: readonly RunEvent[]): string[] {
  const text = JSON.stringify(events);
  const emails = (text.match(EMAIL_RE) ?? []).filter((m) => !/\.example(\.com)?$/i.test(m) && !/@example\.com$/i.test(m));
  const invoices = (text.match(PAYPAL_INV_RE) ?? []).filter((m) => !m.startsWith("INV2-DEMO-"));
  return [...new Set([...emails, ...invoices])];
}

// ---------------------------------------------------------------- playback timing

export interface ReplayTiming {
  /** Playback speed; 1 = recorded pace. */
  speed: number;
  /** Longest pause between two events at speed 1 (long provider calls and waits are trimmed). */
  maxGapMs: number;
  /** Shortest pause, so parallel events still arrive one by one. */
  minGapMs: number;
  /** How long an approval stays AWAITING before the recorded decision arrives (speed 1). */
  approvalHoldMs: number;
}

/** Floor for the AWAITING hold after speed scaling. */
export const MIN_APPROVAL_HOLD_MS = 1500;

export const DEFAULT_TIMING: ReplayTiming = { speed: 1, maxGapMs: 2200, minGapMs: 90, approvalHoldMs: 3200 };

/** Delay before each event (ms, already divided by speed). Pure, so it is unit tested. */
export function replayDelays(events: readonly RunEvent[], timing: Partial<ReplayTiming> = {}): number[] {
  const t = { ...DEFAULT_TIMING, ...timing };
  return events.map((e, i) => {
    if (i === 0) return 0;
    const prev = events[i - 1]!;
    const gap = Date.parse(e.ts) - Date.parse(prev.ts);
    const ms = Math.min(t.maxGapMs, Math.max(t.minGapMs, Number.isFinite(gap) ? gap : t.minGapMs));
    if (e.type === "approval" && e.status !== "pending") {
      // AWAITING stays readable at any speed (fast e2e playback included).
      return Math.round(Math.max(Math.max(ms, t.approvalHoldMs) / t.speed, MIN_APPROVAL_HOLD_MS));
    }
    return Math.round(ms / t.speed);
  });
}

/**
 * Re-stamp a recorded event for playback: the new runId, "now" as ts (the timeline shows when it
 * played; the header shows when it was recorded), and an approval's expiresAt shifted by the same
 * offset so its countdown stays meaningful.
 */
export function restamp(event: RunEvent, runId: string, now: Date): RunEvent {
  const ts = now.toISOString();
  if (event.type === "approval" && event.expiresAt) {
    const left = Date.parse(event.expiresAt) - Date.parse(event.ts);
    return { ...event, runId, ts, expiresAt: new Date(now.getTime() + Math.max(0, left)).toISOString() };
  }
  return { ...event, runId, ts };
}
