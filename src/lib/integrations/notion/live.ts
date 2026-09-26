import "server-only";
import { getEnv } from "../../env";
import { istDateKey } from "../../format";
import { liveCall } from "../live-call";
import { failure, success, type Outcome } from "../result";
import type { CallCtx, LedgerInfo, LedgerRow, NotionAdapter } from "../types";
import {
  DatabaseRawSchema,
  DataSourceRawSchema,
  LEDGER_TITLE,
  PageRawSchema,
  plainText,
  QueryRawSchema,
  richTextEquals,
  schemaPatch,
  SearchRawSchema,
  toLedgerRow,
  toNotionProperties,
  type DataSourceRaw,
} from "./parse";

export const LEDGER_MISSING_HINT =
  `Notion mein "${LEDGER_TITLE}" nahi mila. Notion API pages ke andar naya database nahi bana sakta ` +
  `(Swytchcode ke Notion tools mein "create database" nahi hai), isliye ek baar haath se banana hoga: ` +
  `Bahi page kholo, /database likho, "Database - Inline" chuno, naam "${LEDGER_TITLE}" rakho. Phir: npm run setup:notion`;

export function createNotionLive(): NotionAdapter {
  let ledger: { databaseId: string; dataSourceId: string } | undefined;

  async function getDataSource(id: string, ctx?: CallCtx): Promise<Outcome<DataSourceRaw>> {
    return liveCall("notionGetDataSource", { params: { data_source_id: id } }, DataSourceRawSchema, { ctx, summary: LEDGER_TITLE });
  }

  /** Find the ledger's data source: env ids first, then search by title. */
  async function locate(ctx?: CallCtx): Promise<Outcome<{ ds: DataSourceRaw; databaseId: string } | null>> {
    const env = getEnv();
    let ms = 0;
    if (env.NOTION_LEDGER_DATA_SOURCE_ID) {
      const ds = await getDataSource(env.NOTION_LEDGER_DATA_SOURCE_ID, ctx);
      if (!ds.ok) return ds;
      return success({ ds: ds.value, databaseId: ds.value.parent?.database_id ?? env.NOTION_LEDGER_DATABASE_ID ?? "" }, ds.ms);
    }
    if (env.NOTION_LEDGER_DATABASE_ID) {
      const db = await liveCall("notionGetDatabase", { params: { database_id: env.NOTION_LEDGER_DATABASE_ID } }, DatabaseRawSchema, { ctx, summary: LEDGER_TITLE });
      if (!db.ok) return db;
      const first = db.value.data_sources[0];
      if (!first) return failure({ kind: "provider", message: "Notion ledger database has no data source" }, db.ms);
      const ds = await getDataSource(first.id, ctx);
      if (!ds.ok) return failure(ds.error, db.ms + ds.ms);
      return success({ ds: ds.value, databaseId: db.value.id }, db.ms + ds.ms);
    }
    const found = await liveCall(
      "notionSearch",
      { body: { query: LEDGER_TITLE, filter: { property: "object", value: "data_source" }, page_size: 10 } },
      SearchRawSchema,
      { ctx, summary: LEDGER_TITLE },
    );
    if (!found.ok) return found;
    ms += found.ms;
    const hit = found.value.results.find((r) => r.object === "data_source" && plainText(r.title).trim() === LEDGER_TITLE);
    if (!hit) return success(null, ms);
    const ds = await getDataSource(hit.id, ctx);
    if (!ds.ok) return failure(ds.error, ms + ds.ms);
    return success({ ds: ds.value, databaseId: hit.parent?.database_id ?? ds.value.parent?.database_id ?? "" }, ms + ds.ms);
  }

  async function ensureLedgerDatabase(ctx?: CallCtx): Promise<Outcome<LedgerInfo>> {
    const loc = await locate(ctx);
    if (!loc.ok) return loc;
    if (!loc.value) return failure({ kind: "not_found", message: LEDGER_MISSING_HINT }, loc.ms);
    const { ds, databaseId } = loc.value;
    let ms = loc.ms;

    // Drop unused default columns only while the ledger is still empty.
    const probe = await liveCall("notionQuery", { params: { data_source_id: ds.id }, body: { page_size: 1 } }, QueryRawSchema, { ctx, summary: LEDGER_TITLE });
    if (!probe.ok) return failure(probe.error, ms + probe.ms);
    ms += probe.ms;
    const patch = schemaPatch(ds, probe.value.results.length === 0);
    const title = plainText(ds.title).trim();
    if (patch || title !== LEDGER_TITLE) {
      const upd = await liveCall(
        "notionUpdateDataSource",
        {
          params: { data_source_id: ds.id },
          body: { ...(patch ? { properties: patch.properties } : {}), title: [{ type: "text", text: { content: LEDGER_TITLE } }] },
        },
        DataSourceRawSchema,
        { ctx, summary: LEDGER_TITLE },
      );
      if (!upd.ok) return failure(upd.error, ms + upd.ms);
      ms += upd.ms;
    }
    ledger = { databaseId, dataSourceId: ds.id };
    return success({ databaseId, dataSourceId: ds.id, title: LEDGER_TITLE, addedProperties: patch?.added ?? [], created: false }, ms);
  }

  async function dataSourceId(ctx?: CallCtx): Promise<Outcome<string>> {
    if (ledger) return success(ledger.dataSourceId);
    const env = getEnv();
    if (env.NOTION_LEDGER_DATA_SOURCE_ID) return success(env.NOTION_LEDGER_DATA_SOURCE_ID);
    const loc = await locate(ctx);
    if (!loc.ok) return loc;
    if (!loc.value) return failure({ kind: "not_found", message: LEDGER_MISSING_HINT }, loc.ms);
    ledger = { databaseId: loc.value.databaseId, dataSourceId: loc.value.ds.id };
    return success(loc.value.ds.id, loc.ms);
  }

  async function query(filter: unknown, limit: number, ctx?: CallCtx, summary = LEDGER_TITLE): Promise<Outcome<LedgerRow[]>> {
    const id = await dataSourceId(ctx);
    if (!id.ok) return id;
    const r = await liveCall(
      "notionQuery",
      {
        params: { data_source_id: id.value },
        body: { page_size: Math.min(limit, 100), ...(filter ? { filter } : {}), sorts: [{ timestamp: "created_time", direction: "descending" }] },
      },
      QueryRawSchema,
      { ctx, summary },
    );
    if (!r.ok) return failure(r.error, id.ms + r.ms);
    const rows = r.value.results.filter((p) => !p.in_trash && !p.archived).map(toLedgerRow);
    return success(rows, id.ms + r.ms);
  }

  async function updatePage(pageId: string, props: Record<string, unknown>, ctx: CallCtx | undefined, summary: string): Promise<Outcome<LedgerRow>> {
    const r = await liveCall("notionUpdatePage", { params: { page_id: pageId }, body: { properties: props } }, PageRawSchema, { ctx, summary });
    return r.ok ? success(toLedgerRow(r.value), r.ms) : r;
  }

  return {
    ensureLedgerDatabase,

    listLedger(opts = {}, ctx) {
      const filter = opts.status ? { property: "Status", select: { equals: opts.status } } : undefined;
      return query(filter, opts.limit ?? 100, ctx, opts.status ? `${LEDGER_TITLE}: ${opts.status}` : LEDGER_TITLE);
    },

    async findByIntentKey(intentKey, ctx) {
      const r = await query(richTextEquals("Intent key", intentKey), 1, ctx, `intent ${intentKey}`);
      return r.ok ? success(r.value[0] ?? null, r.ms) : r;
    },

    async upsertLedgerRow(row, ctx) {
      const id = await dataSourceId(ctx);
      if (!id.ok) return id;
      let ms = id.ms;
      let existing: LedgerRow | null = null;
      const key = row.intentKey ?? row.invoiceId;
      if (key) {
        const found = await query(richTextEquals(row.intentKey ? "Intent key" : "Invoice ID", key), 1, ctx, `${row.client}`);
        if (!found.ok) return failure(found.error, ms + found.ms);
        ms += found.ms;
        existing = found.value[0] ?? null;
      }
      if (existing) {
        const upd = await updatePage(existing.pageId, toNotionProperties(row), ctx, row.client);
        return upd.ok ? success({ ...upd.value, created: false }, ms + upd.ms) : failure(upd.error, ms + upd.ms);
      }
      const created = await liveCall(
        "notionCreatePage",
        { body: { parent: { type: "data_source_id", data_source_id: id.value }, properties: toNotionProperties(row) } },
        PageRawSchema,
        { ctx, summary: row.client },
      );
      if (!created.ok) return failure(created.error, ms + created.ms);
      return success({ ...toLedgerRow(created.value), created: true }, ms + created.ms);
    },

    markPaid: (pageId, ctx, paidOn = istDateKey(new Date())) => updatePage(pageId, toNotionProperties({ status: "Paid", paidOn }), ctx, "Paid"),
    setLastReminder: (pageId, date, ctx) => updatePage(pageId, toNotionProperties({ lastReminder: date }), ctx, `reminder ${date}`),

    async archiveRow(pageId, ctx) {
      const r = await liveCall("notionUpdatePage", { params: { page_id: pageId }, body: { in_trash: true } }, PageRawSchema, { ctx, summary: "archive" });
      return r.ok ? success({ pageId }, r.ms) : r;
    },
  };
}
