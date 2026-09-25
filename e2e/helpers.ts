import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { parseRunEventLine, type RunEvent } from "../src/lib/events";
import { foldRunEvents, type RunView } from "../src/lib/run-reducer";

/** The committed recording for a scenario, folded like the browser folds it. */
export function recordedView(scenario: string): RunView {
  const events = readFileSync(path.join(process.cwd(), "fixtures", "runs", `${scenario.toLowerCase()}.ndjson`), "utf8")
    .split("\n")
    .map(parseRunEventLine)
    .filter((e): e is RunEvent => e !== null);
  return foldRunEvents(events);
}

/** Collects console errors and page errors; call check() at the end of a test. */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return {
    errors,
    check: () => expect(errors, errors.join("\n")).toEqual([]),
  };
}

export async function sendCommand(page: Page, text: string) {
  const box = page.locator("#command-input");
  await box.fill(text);
  await box.press("Enter");
}

export const steps = (page: Page) => page.getByRole("list", { name: "Kaam ke kadam" }).locator(":scope > li");

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** A SpeechRecognition stand-in: start() fires onstart; window.__speech.say(text) delivers a final result and ends. */
export const SPEECH_STUB = `
(() => {
  class FakeRecognition {
    constructor() { this.lang = "en-IN"; this.continuous = false; this.interimResults = true; this.maxAlternatives = 1;
      this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; }
    start() { window.__speech.active = this; setTimeout(() => this.onstart && this.onstart(), 10); }
    stop() { setTimeout(() => this.onend && this.onend(), 10); }
    abort() { setTimeout(() => this.onend && this.onend(), 10); }
  }
  window.__speech = {
    active: null,
    say(text) {
      const r = this.active; if (!r) return false;
      const res = [{ transcript: text }]; res.isFinal = true;
      r.onresult && r.onresult({ resultIndex: 0, results: [res] });
      setTimeout(() => r.onend && r.onend(), 10);
      return true;
    },
  };
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
})();
`;

export const NO_SPEECH = `
(() => {
  try { delete window.SpeechRecognition; } catch {}
  try { delete window.webkitSpeechRecognition; } catch {}
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
})();
`;
