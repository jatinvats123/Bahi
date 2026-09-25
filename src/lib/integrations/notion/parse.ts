import { z } from "zod";
import { NOTION_STATUS, NotionStatusSchema, type LedgerRow, type LedgerRowInput } from "../types";

/**
 * Notion JSON <-> ledger rows (API version 2025-09-03, data sources). Pure; tested
 * against fixtures/recorded/notion.
 */

export const LEDGER_TITLE = "Bahi Ledger";

/** The exact ledger schema: property name -> Notion property type. */
export const LEDGER_PROPERTIES = {
  Client: "title",
  "Client Email": "email",
  "Amount INR": "number",
  Description: "rich_text",
  "Invoice ID": "rich_text",
  "Invoice URL": "url",
  Status: "select",
  Issued: "date",
  Due: "date",
  "Last reminder": "date",
  "Jira key": "rich_text",
  "Intent key": "rich_text",
} as const;
export type LedgerProperty = keyof typeof LEDGER_PROPERTIES;

const STATUS_COLOR: Record<(typeof NOTION_STATUS)[number], string> = {
  Draft: "gray",
  "Awaiting approval": "yellow",
  Sent: "blue",
  Paid: "green",
  Overdue: "red",
  Cancelled: "brown",
  Refunded: "purple",
};

/** Definition payload for one property in a data source create/update. */
export function propertyDefinition(name: LedgerProperty): Record<string, unknown> {
  switch (LEDGER_PROPERTIES[name]) {
    case "title":
      return { title: {} };
    case "email":
      return { email: {} };
    case "number":
      return { number: { format: "rupee" } };
    case "rich_text":
      return { rich_text: {} };
    case "url":
      return { url: {} };
    case "date":
      return { date: {} };
    case "select":
      return { select: { options: NOTION_STATUS.map((s) => ({ name: s, color: STATUS_COLOR[s] })) } };
  }
}

const RichText = z.array(z.object({ plain_text: z.string().optional(), text: z.object({ content: z.string() }).loose().optional() }).loose());

export const DataSourceRawSchema = z
  .object({
    object: z.literal("data_source").optional(),
    id: z.string(),
    title: RichText.optional(),
    properties: z.record(z.string(), z.object({ id: z.string().optional(), name: z.string().optional(), type: z.string() }).loose()),
    parent: z.object({ database_id: z.string().optional() }).loose().optional(),
  })
  .loose();
export type DataSourceRaw = z.infer<typeof DataSourceRawSchema>;

export const DatabaseRawSchema = z
  .object({
    id: z.string(),
    title: RichText.optional(),
    data_sources: z.array(z.object({ id: z.string(), name: z.string().optional() }).loose()).default([]),
  })
  .loose();

export const SearchRawSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            object: z.string(),
            id: z.string(),
            title: RichText.optional(),
            parent: z.object({ database_id: z.string().optional() }).loose().optional(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

export function plainText(rt: z.infer<typeof RichText> | undefined): string {
  return (rt ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");
}

/**
 * The data source update that makes the schema exact: rename the title property to
 * "Client", add missing properties, retype wrong ones, and (only when `removeExtras`)
 * drop properties we do not use. Returns null when nothing needs to change.
 */
export function schemaPatch(ds: DataSourceRaw, removeExtras: boolean): { properties: Record<string, unknown>; added: string[] } | null {
  const patch: Record<string, unknown> = {};
  const added: string[] = [];
  const existing = Object.entries(ds.properties).map(([key, p]) => ({ name: p.name ?? key, type: p.type }));
  const titleProp = existing.find((p) => p.type === "title");
  if (titleProp && titleProp.name !== "Client") patch[titleProp.name] = { name: "Client" };

  for (const name of Object.keys(LEDGER_PROPERTIES) as LedgerProperty[]) {
    if (name === "Client") continue;
    const found = existing.find((p) => p.name === name);
    const wanted = LEDGER_PROPERTIES[name];
    if (!found) {
      patch[name] = propertyDefinition(name);
      added.push(name);
    } else if (found.type !== wanted) {
      patch[name] = propertyDefinition(name);
      added.push(`${name} (retyped)`);
    } else if (name === "Status" && statusOptionsMissing(ds)) {
      // Add the missing status options; Notion keeps existing ones by name.
      patch[name] = propertyDefinition(name);
    }
  }
  if (removeExtras) {
    for (const p of existing) {
      if (p.type !== "title" && !(p.name in LEDGER_PROPERTIES)) patch[p.name] = null;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  return { properties: patch, added };
}

function statusOptionsMissing(ds: DataSourceRaw): boolean {
  const entry = Object.entries(ds.properties).find(([key, p]) => (p.name ?? key) === "Status" && p.type === "select");
  const status = entry?.[1] as { select?: { options?: { name: string }[] } } | undefined;
  const names = new Set((status?.select?.options ?? []).map((o) => o.name));
  return NOTION_STATUS.some((s) => !names.has(s));
}

// ---- rows

const PropValue = z
  .object({
    type: z.string(),
    title: RichText.optional(),
    rich_text: RichText.optional(),
    email: z.string().nullable().optional(),
    number: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    select: z.object({ name: z.string() }).loose().nullable().optional(),
    date: z.object({ start: z.string() }).loose().nullable().optional(),
  })
  .loose();

export const PageRawSchema = z
  .object({
    object: z.literal("page").optional(),
    id: z.string(),
    url: z.string().optional(),
    in_trash: z.boolean().optional(),
    archived: z.boolean().optional(),
    properties: z.record(z.string(), PropValue),
  })
  .loose();

export const QueryRawSchema = z
  .object({ results: z.array(PageRawSchema).default([]), has_more: z.boolean().optional(), next_cursor: z.string().nullable().optional() })
  .loose();

function text(p: z.infer<typeof PropValue> | undefined): string | null {
  if (!p) return null;
  const s = plainText(p.title ?? p.rich_text);
  return s === "" ? null : s;
}

function date(p: z.infer<typeof PropValue> | undefined): string | null {
  return p?.date?.start ? p.date.start.slice(0, 10) : null;
}

export function toLedgerRow(page: z.infer<typeof PageRawSchema>): LedgerRow {
  const p = page.properties;
  const status = NotionStatusSchema.safeParse(p.Status?.select?.name);
  return {
    pageId: page.id,
    client: text(p.Client) ?? "",
    clientEmail: p["Client Email"]?.email ?? null,
    amountInr: p["Amount INR"]?.number ?? null,
    description: text(p.Description) ?? "",
    invoiceId: text(p["Invoice ID"]),
    invoiceUrl: p["Invoice URL"]?.url ?? null,
    status: status.success ? status.data : null,
    issued: date(p.Issued),
    due: date(p.Due),
    lastReminder: date(p["Last reminder"]),
    jiraKey: text(p["Jira key"]),
    intentKey: text(p["Intent key"]),
    url: page.url ?? null,
  };
}

const rt = (s: string | null) => ({ rich_text: s ? [{ type: "text", text: { content: s.slice(0, 2000) } }] : [] });
const dt = (s: string | null) => ({ date: s ? { start: s } : null });

/** Page properties payload for a (partial) ledger row. Only keys present in `row` are written. */
export function toNotionProperties(row: Partial<LedgerRowInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (row.client !== undefined) out.Client = { title: [{ type: "text", text: { content: row.client.slice(0, 2000) } }] };
  if (row.clientEmail !== undefined) out["Client Email"] = { email: row.clientEmail };
  if (row.amountInr !== undefined) out["Amount INR"] = { number: row.amountInr };
  if (row.description !== undefined) out.Description = rt(row.description);
  if (row.invoiceId !== undefined) out["Invoice ID"] = rt(row.invoiceId);
  if (row.invoiceUrl !== undefined) out["Invoice URL"] = { url: row.invoiceUrl };
  if (row.status !== undefined) out.Status = { select: row.status ? { name: row.status } : null };
  if (row.issued !== undefined) out.Issued = dt(row.issued);
  if (row.due !== undefined) out.Due = dt(row.due);
  if (row.lastReminder !== undefined) out["Last reminder"] = dt(row.lastReminder);
  if (row.jiraKey !== undefined) out["Jira key"] = rt(row.jiraKey);
  if (row.intentKey !== undefined) out["Intent key"] = rt(row.intentKey);
  return out;
}

export function richTextEquals(property: "Intent key" | "Invoice ID", value: string) {
  return { property, rich_text: { equals: value } };
}
