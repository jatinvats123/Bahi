import "server-only";
import { liveCall } from "../live-call";
import { andThen, success, type Outcome } from "../result";
import type { CallCtx, GmailAdapter } from "../types";
import {
  buildRfc822,
  encodeBase64Url,
  GmailLabelRawSchema,
  GmailLabelsRawSchema,
  GmailListRawSchema,
  GmailMessageRawSchema,
  GmailSentRawSchema,
  gmailSendBody,
  PROCESSED_LABEL,
  toEmailMessage,
  toSummaries,
} from "./parse";

export function createGmailLive(): GmailAdapter {
  let processedLabelId: string | undefined;

  async function ensureProcessedLabel(ctx?: CallCtx): Promise<Outcome<string>> {
    if (processedLabelId) return success(processedLabelId);
    const list = await liveCall("gmailListLabels", { params: { userId: "me" } }, GmailLabelsRawSchema, { ctx, summary: PROCESSED_LABEL });
    if (!list.ok) return list;
    const found = list.value.labels.find((l) => l.name === PROCESSED_LABEL);
    if (found) {
      processedLabelId = found.id;
      return success(found.id, list.ms);
    }
    return andThen(list, async () => {
      const created = await liveCall(
        "gmailCreateLabel",
        { params: { userId: "me" }, body: { name: PROCESSED_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" } },
        GmailLabelRawSchema,
        { ctx, summary: PROCESSED_LABEL },
      );
      if (!created.ok) return created;
      processedLabelId = created.value.id;
      return success(created.value.id, created.ms);
    });
  }

  return {
    async listUnread(opts = {}, ctx) {
      const r = await liveCall(
        "gmailListMessages",
        { params: { userId: "me", q: `is:unread in:inbox -label:${PROCESSED_LABEL.replace("/", "-")}`, maxResults: opts.max ?? 10 } },
        GmailListRawSchema,
        { ctx, summary: "unread inbox" },
      );
      return r.ok ? success(toSummaries(r.value), r.ms) : r;
    },

    async getMessage(id, ctx) {
      const r = await liveCall("gmailGetMessage", { params: { userId: "me", id, format: "full" } }, GmailMessageRawSchema, { ctx, summary: id });
      return r.ok ? success(toEmailMessage(r.value), r.ms) : r;
    },

    async sendEmail(input, ctx) {
      const body = gmailSendBody(input);
      const r = await liveCall("gmailSend", { params: { userId: "me" }, body }, GmailSentRawSchema, { ctx, summary: `${input.to}: ${input.subject}` });
      return r.ok ? success({ id: r.value.id, threadId: r.value.threadId }, r.ms) : r;
    },

    async markProcessed(id, ctx) {
      const label = await ensureProcessedLabel(ctx);
      return andThen(label, async (labelId) => {
        const r = await liveCall(
          "gmailModify",
          { params: { userId: "me", id }, body: { addLabelIds: [labelId], removeLabelIds: ["UNREAD"] } },
          GmailSentRawSchema,
          { ctx, summary: id },
        );
        return r.ok ? success({ id }, r.ms) : r;
      });
    },

    async insertMessage(input, ctx) {
      const body = { raw: encodeBase64Url(buildRfc822(input)), labelIds: ["INBOX", "UNREAD"] };
      const r = await liveCall("gmailInsert", { params: { userId: "me", internalDateSource: "dateHeader" }, body }, GmailSentRawSchema, {
        ctx,
        summary: `${input.from}: ${input.subject}`,
      });
      return r.ok ? success({ id: r.value.id }, r.ms) : r;
    },
  };
}
