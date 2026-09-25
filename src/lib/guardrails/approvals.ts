import "server-only";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { renameWithRetry } from "../store/runs";

/**
 * Bahi's approval desk. When the Swytchcode gate policy (invoice-approval-over-threshold)
 * holds a large invoice, the run creates an approval here and waits. The owner decides on
 * the dashboard (POST /api/approvals/:id) or with `npm run approve`; the run then re-issues
 * the call with an approval stamp that the policy lets through.
 *
 * Stored in data/approvals.json so a decision made in one process (the Next server) reaches
 * a run waiting in another (npm run scenario). Waiters poll the file once a second and also
 * wake up at once for decisions made in their own process.
 */

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired"] as const;
export type ApprovalRecordStatus = (typeof APPROVAL_STATUSES)[number];

export const ApprovalRecordSchema = z.object({
  id: z.string().regex(/^apr_[0-9a-z]{8,}$/),
  runId: z.string().nullable(),
  callId: z.string(),
  status: z.enum(APPROVAL_STATUSES),
  via: z.enum(["bahi", "swytchcode"]),
  policyId: z.string(),
  tool: z.string(),
  client: z.string(),
  amountInr: z.number(),
  description: z.string(),
  channel: z.string(),
  explain: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedAt: z.string().nullable(),
  by: z.string().nullable(),
  /** Swytchcode HITL request id (APPROVAL_MODE=swytchcode). */
  swytchcodeRequestId: z.string().nullable().default(null),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

const FileSchema = z.object({ version: z.literal(1), approvals: z.array(ApprovalRecordSchema) });
const MAX_KEPT = 200;

export type NewApproval = Omit<ApprovalRecord, "id" | "status" | "createdAt" | "decidedAt" | "by" | "expiresAt" | "swytchcodeRequestId"> & {
  timeoutMs: number;
  swytchcodeRequestId?: string | null;
};

export type DecideResult = { ok: true; record: ApprovalRecord } | { ok: false; reason: "not_found" | "already_decided" | "expired"; record?: ApprovalRecord };

export function newApprovalId(): string {
  return `apr_${randomBytes(6).toString("hex")}`;
}

export function createApprovalStore(filePath: string, now: () => Date = () => new Date()) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  async function readAll(): Promise<ApprovalRecord[]> {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(await readFile(filePath, "utf8")));
      return parsed.success ? parsed.data.approvals : [];
    } catch {
      return [];
    }
  }

  async function writeAll(approvals: ApprovalRecord[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, approvals: approvals.slice(0, MAX_KEPT) }, null, 2), "utf8");
    await renameWithRetry(tmp, filePath);
  }

  /** Pending approvals past their deadline become expired (on every read). */
  function settleExpired(list: ApprovalRecord[]): { list: ApprovalRecord[]; changed: ApprovalRecord[] } {
    const t = now();
    const changed: ApprovalRecord[] = [];
    const out = list.map((a) => {
      if (a.status === "pending" && Date.parse(a.expiresAt) <= t.getTime()) {
        const e = { ...a, status: "expired" as const, decidedAt: t.toISOString() };
        changed.push(e);
        return e;
      }
      return a;
    });
    return { list: out, changed };
  }

  async function update(fn: (list: ApprovalRecord[]) => ApprovalRecord[] | null): Promise<ApprovalRecord[]> {
    return serialize(async () => {
      const { list, changed } = settleExpired(await readAll());
      const next = fn(list);
      if (next || changed.length) await writeAll(next ?? list);
      for (const c of changed) bus.emit(c.id, c);
      return next ?? list;
    });
  }

  const store = {
    async create(input: NewApproval): Promise<ApprovalRecord> {
      const t = now();
      const { timeoutMs, ...rest } = input;
      const record = ApprovalRecordSchema.parse({
        ...rest,
        id: newApprovalId(),
        status: "pending",
        createdAt: t.toISOString(),
        expiresAt: new Date(t.getTime() + timeoutMs).toISOString(),
        decidedAt: null,
        by: null,
        swytchcodeRequestId: input.swytchcodeRequestId ?? null,
      });
      await update((list) => [record, ...list.filter((a) => a.id !== record.id)]);
      return record;
    },

    async list(): Promise<ApprovalRecord[]> {
      return update(() => null);
    },

    async get(id: string): Promise<ApprovalRecord | null> {
      return (await store.list()).find((a) => a.id === id) ?? null;
    },

    async decide(id: string, decision: "approved" | "denied", by: string): Promise<DecideResult> {
      let result = { ok: false, reason: "not_found" } as DecideResult;
      await update((list) => {
        const i = list.findIndex((a) => a.id === id);
        const cur = list[i];
        if (!cur) return null;
        if (cur.status === "expired") {
          result = { ok: false, reason: "expired", record: cur };
          return null;
        }
        if (cur.status !== "pending") {
          result = { ok: false, reason: "already_decided", record: cur };
          return null;
        }
        const next = { ...cur, status: decision, decidedAt: now().toISOString(), by };
        result = { ok: true, record: next };
        const copy = [...list];
        copy[i] = next;
        return copy;
      });
      if (result.ok) bus.emit(id, result.record);
      return result;
    },

    /** Mark a pending approval expired now (the run gave up waiting). */
    async expire(id: string): Promise<ApprovalRecord | null> {
      let out = null as ApprovalRecord | null;
      await update((list) => {
        const i = list.findIndex((a) => a.id === id);
        const cur = list[i];
        if (!cur) return null;
        if (cur.status !== "pending") {
          out = cur;
          return null;
        }
        out = { ...cur, status: "expired", decidedAt: now().toISOString() };
        const copy = [...list];
        copy[i] = out;
        return copy;
      });
      if (out) bus.emit(id, out);
      return out;
    },

    /**
     * Wait until the approval is decided or expires. onTick fires every tickMs (heartbeats).
     * An aborted signal expires the approval (the run was stopped).
     */
    async waitForDecision(id: string, opts: { signal?: AbortSignal; pollMs?: number; tickMs?: number; onTick?: (waitedSec: number) => void } = {}): Promise<ApprovalRecord | null> {
      const started = Date.now();
      const pollMs = opts.pollMs ?? 1_000;
      const tickMs = opts.tickMs ?? 10_000;
      let lastTick = started;
      return new Promise<ApprovalRecord | null>((resolve) => {
        let finished = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (r: ApprovalRecord | null) => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          bus.off(id, onBus);
          opts.signal?.removeEventListener("abort", onAbort);
          resolve(r);
        };
        const onBus = (r: ApprovalRecord) => {
          if (r.status !== "pending") finish(r);
        };
        const onAbort = () => void store.expire(id).then(finish, () => finish(null));
        bus.on(id, onBus);
        if (opts.signal?.aborted) return onAbort();
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        const poll = async () => {
          if (finished) return;
          const r = await store.get(id).catch(() => null);
          if (!r) return finish(null);
          if (r.status !== "pending") return finish(r);
          if (Date.now() - lastTick >= tickMs) {
            lastTick = Date.now();
            opts.onTick?.((Date.now() - started) / 1000);
          }
          timer = setTimeout(() => void poll(), pollMs);
        };
        void poll();
      });
    },
  };
  return store;
}

export type ApprovalStore = ReturnType<typeof createApprovalStore>;

const GLOBAL_KEY = Symbol.for("bahi.approvalStore");
type WithStore = typeof globalThis & { [GLOBAL_KEY]?: ApprovalStore };

/** The app's approval store at data/approvals.json (one per process, survives dev reloads). */
export function getApprovalStore(): ApprovalStore {
  const g = globalThis as WithStore;
  g[GLOBAL_KEY] ??= createApprovalStore(path.join(process.cwd(), "data", "approvals.json"));
  return g[GLOBAL_KEY];
}
