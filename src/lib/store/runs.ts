import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RunRecordSchema, type RunRecord } from "../run-record";

/**
 * Run history repository backed by a single JSON file (default data/runs.json).
 * - Writes are serialized in-process and atomic (temp file + rename).
 * - A corrupt file is moved aside as runs.corrupt-<time>.json, never silently overwritten.
 * - Keeps the newest MAX_RUNS runs.
 */

const MAX_RUNS = 200;
const FileSchema = z.object({ version: z.literal(1), runs: z.array(RunRecordSchema) });

export interface RunStore {
  list(): Promise<RunRecord[]>;
  get(runId: string): Promise<RunRecord | null>;
  save(record: RunRecord): Promise<void>;
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  // Windows can briefly lock files (antivirus, indexer); retry a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

export function createRunStore(filePath: string): RunStore {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  async function readAll(): Promise<{ runs: RunRecord[]; corrupt: boolean }> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], corrupt: false };
      throw err;
    }
    try {
      const parsed = FileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return { runs: parsed.data.runs, corrupt: false };
    } catch {
      // fall through
    }
    console.warn(`[runs] ${filePath} is not valid run history; ignoring it until the next save moves it aside.`);
    return { runs: [], corrupt: true };
  }

  async function writeAll(runs: RunRecord[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, runs }, null, 2), "utf8");
    await renameWithRetry(tmp, filePath);
  }

  const newestFirst = (a: RunRecord, b: RunRecord) => b.startedAt.localeCompare(a.startedAt);

  return {
    list: () => serialize(async () => (await readAll()).runs.sort(newestFirst)),
    get: (runId) => serialize(async () => (await readAll()).runs.find((r) => r.runId === runId) ?? null),
    save: (record) =>
      serialize(async () => {
        const valid = RunRecordSchema.parse(record);
        const { runs, corrupt } = await readAll();
        if (corrupt) {
          const aside = filePath.replace(/\.json$/, "") + `.corrupt-${Date.now()}.json`;
          await renameWithRetry(filePath, aside);
          console.warn(`[runs] moved unreadable history to ${aside}`);
        }
        const next = [valid, ...runs.filter((r) => r.runId !== valid.runId)].sort(newestFirst).slice(0, MAX_RUNS);
        await writeAll(next);
      }),
  };
}

let defaultStore: RunStore | undefined;

/** The app's run store at data/runs.json. */
export function getRunStore(): RunStore {
  defaultStore ??= createRunStore(path.join(process.cwd(), "data", "runs.json"));
  return defaultStore;
}
