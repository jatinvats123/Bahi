import "server-only";
import { getEnv } from "../../env";
import { liveCall } from "../live-call";
import { success } from "../result";
import type { JiraAdapter } from "../types";
import { browseUrl, deliveryIssueFields, deliverySummary, invoiceLabel, JiraCreatedRawSchema, JiraProjectRawSchema, JiraSearchRawSchema, toJiraIssue } from "./parse";

export function createJiraLive(): JiraAdapter {
  return {
    async createDeliveryTask(input, ctx) {
      const env = getEnv();
      const r = await liveCall("jiraCreateIssue", { body: { fields: deliveryIssueFields(input, env.JIRA_PROJECT_KEY) } }, JiraCreatedRawSchema, {
        ctx,
        summary: deliverySummary(input),
      });
      if (!r.ok) return r;
      return success({ id: r.value.id, key: r.value.key, url: browseUrl(env.JIRA_BASE_URL, r.value.key), summary: deliverySummary(input), status: null }, r.ms);
    },

    async findTaskByInvoiceId(invoiceId, ctx) {
      const env = getEnv();
      const jql = `project = "${env.JIRA_PROJECT_KEY}" AND labels = "${invoiceLabel(invoiceId)}" ORDER BY created DESC`;
      const r = await liveCall("jiraSearch", { body: { jql, maxResults: 1, fields: ["summary", "status"] } }, JiraSearchRawSchema, { ctx, summary: invoiceId });
      if (!r.ok) return r;
      const first = r.value.issues[0];
      return success(first ? toJiraIssue(first, env.JIRA_BASE_URL) : null, r.ms);
    },

    async getProject(ctx) {
      const key = getEnv().JIRA_PROJECT_KEY;
      const r = await liveCall("jiraGetProject", { params: { projectIdOrKey: key } }, JiraProjectRawSchema, { ctx, summary: key });
      return r.ok ? success({ key: r.value.key, name: r.value.name, id: r.value.id }, r.ms) : r;
    },
  };
}
