import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseRunEventLine, type RunEvent } from "../events";
import type { ScenarioId } from "../scenarios";
import { RecordingIndexSchema, type Recording, type RecordingIndex } from "./recording";

/** Reads fixtures/runs/ (written by npm run record:replays). Cached per process. */

const DIR = path.join(process.cwd(), "fixtures", "runs");

let index: Promise<RecordingIndex> | undefined;
const cache = new Map<ScenarioId, Promise<Recording | null>>();

export function loadRecordingIndex(): Promise<RecordingIndex> {
  index ??= readFile(path.join(DIR, "index.json"), "utf8").then((raw) => RecordingIndexSchema.parse(JSON.parse(raw)));
  index.catch(() => (index = undefined));
  return index;
}

export function loadRecording(scenario: ScenarioId): Promise<Recording | null> {
  let p = cache.get(scenario);
  if (!p) {
    p = (async () => {
      const meta = (await loadRecordingIndex()).recordings.find((r) => r.scenario === scenario);
      if (!meta) return null;
      const raw = await readFile(path.join(DIR, meta.file), "utf8");
      const events = raw.split("\n").map(parseRunEventLine).filter((e): e is RunEvent => e !== null);
      if (events.length !== meta.events) throw new Error(`fixtures/runs/${meta.file}: expected ${meta.events} events, parsed ${events.length}`);
      return { meta, events };
    })();
    p.catch(() => cache.delete(scenario));
    cache.set(scenario, p);
  }
  return p;
}
