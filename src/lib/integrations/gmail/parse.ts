import { z } from "zod";
import { alignedToLine } from "../../guardrails/policies";
import type { EmailMessage, EmailSummary, InsertEmailInput, SendEmailInput } from "../types";

/** Gmail JSON <-> domain. Pure; tested against fixtures/recorded/gmail. */

export const PROCESSED_LABEL = "Bahi/Processed";

/** Gmail search for mail Bahi has not handled yet; `afterEpochSec` limits it to mail after the inbox cursor. */
export function unreadQuery(afterEpochSec: number | null): string {
  const base = `is:unread in:inbox -label:${PROCESSED_LABEL.replace("/", "-")}`;
  return afterEpochSec === null ? base : `${base} after:${afterEpochSec}`;
}
const BODY_LIMIT = 6000;

export const GmailListRawSchema = z
  .object({
    messages: z.array(z.object({ id: z.string(), threadId: z.string() }).loose()).optional(),
    resultSizeEstimate: z.number().optional(),
  })
  .loose();

export function toSummaries(raw: z.infer<typeof GmailListRawSchema>): EmailSummary[] {
  return (raw.messages ?? []).map((m) => ({ id: m.id, threadId: m.threadId }));
}

interface RawPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: RawPart[];
}
const PartSchema: z.ZodType<RawPart> = z.lazy(() =>
  z
    .object({
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
      body: z.object({ data: z.string().optional(), size: z.number().optional() }).loose().optional(),
      parts: z.array(PartSchema).optional(),
    })
    .loose(),
);

export const GmailMessageRawSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    labelIds: z.array(z.string()).optional(),
    snippet: z.string().optional(),
    internalDate: z.string().optional(),
    payload: PartSchema.optional(),
  })
  .loose();

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function header(part: RawPart | undefined, name: string): string | null {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function findText(part: RawPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data && !part.filename) return decodeBase64Url(part.body.data);
  for (const p of part.parts ?? []) {
    const t = findText(p, mime);
    if (t) return t;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Rakesh Sharma <rakesh@x.in>" -> "rakesh@x.in" */
export function emailAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim().toLowerCase();
}

export function toEmailMessage(raw: z.infer<typeof GmailMessageRawSchema>): EmailMessage {
  const p = raw.payload;
  const from = header(p, "From") ?? "";
  const plain = findText(p, "text/plain");
  const html = plain ? null : findText(p, "text/html");
  const body = (plain ?? (html ? htmlToText(html) : raw.snippet ?? "")).replace(/\r\n/g, "\n").trim();
  const dateHeader = header(p, "Date");
  const received = raw.internalDate ? new Date(Number(raw.internalDate)) : dateHeader ? new Date(dateHeader) : new Date(0);
  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    fromEmail: emailAddress(from),
    to: header(p, "To") ?? "",
    subject: header(p, "Subject") ?? "(no subject)",
    receivedAt: Number.isNaN(received.getTime()) ? new Date(0).toISOString() : received.toISOString(),
    snippet: raw.snippet ?? "",
    bodyText: body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}\n[...]` : body,
    labelIds: raw.labelIds ?? [],
    messageIdHeader: header(p, "Message-ID") ?? header(p, "Message-Id"),
  };
}

/** RFC 2047 encode a header value when it is not plain ASCII. */
function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function stripNewlines(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

/** Minimal RFC 822 text/plain message. Header values are stripped of newlines (no header injection). */
export function buildRfc822(input: SendEmailInput | InsertEmailInput): string {
  const lines = [
    ...("from" in input ? [`From: ${stripNewlines(input.from)}`] : []),
    // Outgoing mail starts with a 3-byte-aligned To line so the email-known-clients-only policy can match it (see alignedToLine).
    "from" in input ? `To: ${stripNewlines(input.to)}` : alignedToLine(stripNewlines(input.to)).slice(0, -2),
    `Subject: ${encodeHeader(stripNewlines(input.subject))}`,
    ...("date" in input && input.date ? [`Date: ${new Date(input.date).toUTCString()}`] : []),
    ...("inReplyTo" in input && input.inReplyTo ? [`In-Reply-To: ${stripNewlines(input.inReplyTo)}`, `References: ${stripNewlines(input.inReplyTo)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text.replace(/\r?\n/g, "\r\n"),
  ];
  return lines.join("\r\n");
}

/** Body for gmail.user.send.create1 (messages/send). */
export function gmailSendBody(input: SendEmailInput): { raw: string; threadId?: string } {
  return { raw: encodeBase64Url(buildRfc822(input)), ...(input.threadId ? { threadId: input.threadId } : {}) };
}

export const GmailSentRawSchema = z.object({ id: z.string(), threadId: z.string() }).loose();
export const GmailLabelsRawSchema = z.object({ labels: z.array(z.object({ id: z.string(), name: z.string() }).loose()).default([]) }).loose();
export const GmailLabelRawSchema = z.object({ id: z.string(), name: z.string() }).loose();
