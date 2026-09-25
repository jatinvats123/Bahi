import "server-only";
import type { RunEvent } from "../events";
import { recordFromEvents } from "../run-record";
import { getRunStore, type RunStore } from "./runs";

/**
 * Appends a live run's events to the run store while it streams. Saves are
 * throttled (the whole record is rewritten atomically each time) and serialized by
 * the store, so concurrent runs cannot corrupt data/runs.json. flush() writes the
 * final state and never throws.
 */
export function createRunPersister(opts: { store?: RunStore; intervalMs?: number } = {}) {
  const store = opts.store ?? getRunStore();
  const intervalMs = opts.intervalMs ?? 1_000;
  const events: RunEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const save = () => {
    timer = null;
    const record = recordFromEvents(events);
    if (!record) return chain;
    chain = chain.then(() => store.save(record)).catch((e: unknown) => console.error("[runs] could not save run", e));
    return chain;
  };

  return {
    add(event: RunEvent) {
      events.push(event);
      // First event saves at once so the run appears on /activity immediately.
      if (events.length === 1) void save();
      else timer ??= setTimeout(() => void save(), intervalMs);
    },
    async flush(): Promise<void> {
      if (timer) clearTimeout(timer);
      await save();
    },
  };
}
