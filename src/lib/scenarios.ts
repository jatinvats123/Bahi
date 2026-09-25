import { extractAmounts } from "./agent/amount";

/**
 * The demo scenarios (CLAUDE.md section 4) as the owner would say them. Used by the example
 * chips, the hidden Demo controls and replay mode, which maps a command to its recording.
 * Pure module: safe in the browser.
 */

export const SCENARIO_IDS = ["S1", "S2", "S2-deny", "S3", "S4", "S5", "S6"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface Scenario {
  id: ScenarioId;
  /** Short chip label. */
  label: string;
  command: string;
  /** Shown as an example chip on the Command page (S2-deny is Demo controls only). */
  chip: boolean;
}

export const SCENARIOS: readonly Scenario[] = [
  { id: "S1", label: "Sharma Traders ko 15,000 ka invoice", command: "Sharma Traders ko website redesign ke liye 15,000 ka invoice bhejo", chip: true },
  { id: "S2", label: "Verma Sweets ko 80,000 ka invoice", command: "Verma Sweets ko 80,000 ka invoice bhejo", chip: true },
  { id: "S2-deny", label: "Gupta ko 60,000 (mana)", command: "Gupta Electronics ko showroom lighting ke liye 60,000 ka invoice bhejo", chip: false },
  { id: "S3", label: "Inbox check karo", command: "Inbox check karo aur jo kaam hai woh karo", chip: true },
  { id: "S4", label: "Kaun late hai? Yaad dilao", command: "Kaun late hai? Sabko yaad dilao", chip: true },
  { id: "S5", label: "Sabke payments refund kar do", command: "Sabke payments refund kar do", chip: true },
  { id: "S6", label: "Aaj ka hisaab batao", command: "Aaj ka hisaab batao", chip: true },
];

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === "string" && (SCENARIO_IDS as readonly string[]).includes(v);
}

export function getScenario(id: ScenarioId): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

/**
 * Which recording answers a command in replay mode. Keyword routing, deliberately simple and
 * predictable: refunds S5, inbox S3, reminders S4, the daily brief S6, invoices S1 or S2 by
 * amount (above the approval threshold is S2). Null when no recording fits.
 */
export function matchScenario(command: string, approvalThresholdInr: number): ScenarioId | null {
  const t = command.toLowerCase();
  if (/\brefund|\bwaapas|\bwapas/.test(t)) return "S5";
  if (/\binbox|\bemails?\b|\bmails?\b/.test(t)) return "S3";
  if (/\blate\b|\boverdue|\byaad\b|\bremind/.test(t)) return "S4";
  if (/\bhisaab|\bhisab|\bbrief\b|\bsummary\b/.test(t)) return "S6";
  if (/\binvoice|\bbill\b/.test(t)) {
    const amount = extractAmounts(command)[0];
    if (amount === undefined) return null;
    return amount > approvalThresholdInr ? "S2" : "S1";
  }
  return null;
}
