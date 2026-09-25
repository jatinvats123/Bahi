import "server-only";
import { getEnv } from "../env";
import { createGmailLive } from "./gmail/live";
import { createJiraLive } from "./jira/live";
import { createGmailMock, createJiraMock, createNotionMock, createPaypalMock, createSlackMock } from "./mock/adapters";
import { createNotionLive } from "./notion/live";
import { createPaypalLive } from "./paypal/live";
import { createSlackLive } from "./slack/live";
import type { Integrations } from "./types";

/**
 * The integration set for the current SWYTCH_MODE. Live adapters go through
 * Swytchcode; mock adapters use fixtures. Both satisfy the same interfaces.
 */

export function createIntegrations(mode: "live" | "mock"): Integrations {
  if (mode === "live") {
    return { mode, paypal: createPaypalLive(), gmail: createGmailLive(), slack: createSlackLive(), notion: createNotionLive(), jira: createJiraLive() };
  }
  return { mode, paypal: createPaypalMock(), gmail: createGmailMock(), slack: createSlackMock(), notion: createNotionMock(), jira: createJiraMock() };
}

let current: Integrations | undefined;

export function getIntegrations(): Integrations {
  current ??= createIntegrations(getEnv().SWYTCH_MODE);
  return current;
}

export type * from "./types";
