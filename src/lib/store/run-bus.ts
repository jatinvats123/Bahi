import "server-only";
import type { RunEvent } from "../events";

/**
 * Live runs in this server process. A run keeps going when the browser disconnects (it may be
 * waiting for an approval); the Command page reattaches with GET /api/runs/:id?tail=1, which
 * replays the events so far and then streams new ones. Stop is explicit: POST /api/runs/:id/stop.
 */

type Listener = (event: RunEvent | null) => void;

interface LiveRun {
  runId: string;
  events: RunEvent[];
  listeners: Set<Listener>;
  done: boolean;
  abort: AbortController;
  startedAt: number;
}

const KEEP_FINISHED_MS = 60_000;

function createRunBus() {
  const runs = new Map<string, LiveRun>();
  return {
    start(runId: string, abort: AbortController): void {
      runs.set(runId, { runId, events: [], listeners: new Set(), done: false, abort, startedAt: Date.now() });
    },
    publish(runId: string, event: RunEvent): void {
      const run = runs.get(runId);
      if (!run) return;
      run.events.push(event);
      for (const l of run.listeners) l(event);
    },
    finish(runId: string): void {
      const run = runs.get(runId);
      if (!run) return;
      run.done = true;
      for (const l of run.listeners) l(null);
      run.listeners.clear();
      setTimeout(() => runs.delete(runId), KEEP_FINISHED_MS).unref?.();
    },
    /** Events so far plus a subscription for the rest; null when the run is not live here. */
    tail(runId: string, listener: Listener): { events: RunEvent[]; done: boolean; unsubscribe: () => void } | null {
      const run = runs.get(runId);
      if (!run) return null;
      if (!run.done) run.listeners.add(listener);
      return { events: [...run.events], done: run.done, unsubscribe: () => run.listeners.delete(listener) };
    },
    stop(runId: string): boolean {
      const run = runs.get(runId);
      if (!run || run.done) return false;
      run.abort.abort(new Error("owner stopped the run"));
      return true;
    },
    live(): { runId: string; startedAt: number }[] {
      return [...runs.values()].filter((r) => !r.done).map((r) => ({ runId: r.runId, startedAt: r.startedAt }));
    },
  };
}

export type RunBus = ReturnType<typeof createRunBus>;

const KEY = Symbol.for("bahi.runBus");
type WithBus = typeof globalThis & { [KEY]?: RunBus };

export function getRunBus(): RunBus {
  const g = globalThis as WithBus;
  g[KEY] ??= createRunBus();
  return g[KEY];
}
