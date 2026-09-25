import { z } from "zod";
import { formatINR } from "../../format";
import type { DeliveryTaskInput, JiraIssue } from "../types";

/** Jira Cloud REST v3 JSON <-> domain. Pure; tested against fixtures/recorded/jira. */

/** Jira labels cannot contain spaces; keep them to a safe charset. */
export function invoiceLabel(invoiceId: string): string {
  return `bahi-inv-${invoiceId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** Atlassian Document Format paragraph list. */
function adf(paragraphs: string[]) {
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}

export function deliveryIssueFields(input: DeliveryTaskInput, projectKey: string) {
  return {
    project: { key: projectKey },
    issuetype: { name: "Task" },
    summary: `Deliver: ${input.description} (${input.clientName})`.slice(0, 250),
    labels: ["bahi", invoiceLabel(input.invoiceId)],
    description: adf([
      `Payment received from ${input.clientName}: ${formatINR(input.amountInr)}.`,
      `PayPal invoice: ${input.invoiceId}`,
      "Created by Bahi after the payment was verified in PayPal.",
    ]),
  };
}

export const JiraCreatedRawSchema = z.object({ id: z.string(), key: z.string(), self: z.string().optional() }).loose();

export const JiraIssueRawSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    fields: z.object({ summary: z.string().optional(), status: z.object({ name: z.string() }).loose().optional() }).loose().optional(),
  })
  .loose();

export const JiraSearchRawSchema = z.object({ issues: z.array(JiraIssueRawSchema).default([]) }).loose();

export const JiraProjectRawSchema = z.object({ id: z.string(), key: z.string(), name: z.string() }).loose();

export function browseUrl(baseUrl: string | undefined, key: string): string | null {
  return baseUrl ? `${baseUrl.replace(/\/+$/, "")}/browse/${key}` : null;
}

export function toJiraIssue(raw: z.infer<typeof JiraIssueRawSchema>, baseUrl: string | undefined): JiraIssue {
  return { id: raw.id, key: raw.key, url: browseUrl(baseUrl, raw.key), summary: raw.fields?.summary ?? null, status: raw.fields?.status?.name ?? null };
}
