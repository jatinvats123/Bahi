import { z } from "zod";
import type { ExecError } from "../../swytch/errors";

/** Slack JSON -> domain. Pure; tested against fixtures/recorded/slack. */

/** Slack reports failures as HTTP 200 with {"ok": false, "error": "..."}. */
export const SlackEnvelopeSchema = z.object({ ok: z.boolean(), error: z.string().optional() }).loose();

export function slackError(error: string | undefined): ExecError {
  const code = error ?? "unknown_error";
  if (["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "missing_scope"].includes(code)) {
    return { kind: "auth", message: `Slack: ${code}` };
  }
  if (code === "channel_not_found" || code === "not_in_channel") return { kind: "not_found", message: `Slack: ${code}` };
  if (code === "ratelimited") return { kind: "provider", message: "Slack: rate limited", retryable: true };
  return { kind: "provider", message: `Slack: ${code}` };
}

export const SlackChannelsRawSchema = z
  .object({
    ok: z.literal(true),
    channels: z.array(z.object({ id: z.string(), name: z.string(), is_member: z.boolean().optional(), is_archived: z.boolean().optional() }).loose()).default([]),
    response_metadata: z.object({ next_cursor: z.string().optional() }).loose().optional(),
  })
  .loose();

export const SlackPostRawSchema = z.object({ ok: z.literal(true), channel: z.string(), ts: z.string() }).loose();

/** First line of a Slack message for the timeline (never secrets: it is the agent's own text). */
export function preview(text: string): string {
  const first = text.split("\n")[0]?.trim() ?? "";
  return first.length > 90 ? `${first.slice(0, 89)}...` : first;
}
