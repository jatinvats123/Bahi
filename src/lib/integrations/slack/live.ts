import "server-only";
import { getEnv } from "../../env";
import { liveCall } from "../live-call";
import { failure, success, type Outcome } from "../result";
import type { CallCtx, SlackAdapter, SlackPost } from "../types";
import { slackError, SlackChannelsRawSchema, SlackEnvelopeSchema, SlackPostRawSchema, preview } from "./parse";

/** Slack answers HTTP 200 {"ok": false, "error": "..."} on failure. */
function slackCheck(data: unknown) {
  const env = SlackEnvelopeSchema.safeParse(data);
  return env.success && !env.data.ok ? slackError(env.data.error) : null;
}

/** Satisfies the bundle's required "token" input; Swytchcode injects the real OAuth token (see ExecInput.token). */
const MANAGED_TOKEN = "swytchcode-managed";

export function createSlackLive(): SlackAdapter {
  const channelIds = new Map<string, string>();

  async function resolveChannel(name: string, ctx?: CallCtx): Promise<Outcome<{ id: string; name: string }>> {
    const clean = name.replace(/^#/, "");
    const cached = channelIds.get(clean);
    if (cached) return success({ id: cached, name: clean });
    let cursor: string | undefined;
    let ms = 0;
    for (let page = 0; page < 5; page++) {
      const r = await liveCall(
        "slackListChannels",
        { params: { types: "public_channel,private_channel", exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}) } },
        SlackChannelsRawSchema,
        { ctx, summary: `#${clean}`, check: slackCheck, what: "Slack channel list" },
      );
      if (!r.ok) return failure(r.error, ms + r.ms);
      ms += r.ms;
      for (const c of r.value.channels) channelIds.set(c.name, c.id);
      const hit = channelIds.get(clean);
      if (hit) return success({ id: hit, name: clean }, ms);
      cursor = r.value.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return failure({ kind: "not_found", message: `Slack channel #${clean} not found. Create it and invite the Swytchcode Slack app.` }, ms);
  }

  async function post(channelName: string, text: string, ctx?: CallCtx, kind: "update" | "alert" = "update"): Promise<Outcome<SlackPost>> {
    const ch = await resolveChannel(channelName, ctx);
    if (!ch.ok) return ch;
    const send = () =>
      liveCall("slackPost", { token: MANAGED_TOKEN, body: { channel: ch.value.id, text, unfurl_links: false, unfurl_media: false } }, SlackPostRawSchema, {
        ctx,
        summary: `#${ch.value.name}${kind === "alert" ? " (alert)" : ""}: ${preview(text)}`,
        check: slackCheck,
        what: "Slack post",
      });
    let r = await send();
    // A bot must be in a channel to post; join once and retry.
    if (!r.ok && r.error.message === "Slack: not_in_channel") {
      const join = await liveCall("slackJoinChannel", { token: MANAGED_TOKEN, body: { channel: ch.value.id } }, SlackEnvelopeSchema, { ctx, summary: `#${ch.value.name}`, check: slackCheck });
      if (!join.ok) return join;
      r = await send();
    }
    if (!r.ok) return failure(r.error, r.ms + ch.ms);
    return success({ channelId: r.value.channel, channelName: ch.value.name, ts: r.value.ts }, r.ms + ch.ms);
  }

  return {
    resolveChannel,
    postOps: (text, ctx) => post(getEnv().SLACK_OPS_CHANNEL, text, ctx),
    postAlert: (text, ctx) => {
      const env = getEnv();
      return post(env.SLACK_ALERTS_CHANNEL ?? env.SLACK_OPS_CHANNEL, text, ctx, "alert");
    },
  };
}
