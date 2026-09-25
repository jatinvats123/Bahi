/**
 * Screenshots of every page at 390, 768, 1280 and 1440 px, light and dark, against a running server.
 *
 *   npm run screenshots -- --base http://127.0.0.1:3210 --out .tmp/screens
 *   npm run screenshots -- --readme            the README set into docs/screenshots/
 *
 * Also captures the Command page after a finished S2 run (recorded) at 1440 and 390.
 * Prints console errors and horizontal overflow per shot. Needs AGENT_MODE=replay for the runs.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const readme = process.argv.includes("--readme");
const base = arg("base", "http://127.0.0.1:3210");
const out = arg("out", readme ? "docs/screenshots" : ".tmp/screens");
mkdirSync(out, { recursive: true });

const PAGES = [
  ["command", "/"],
  ["ledger", "/ledger"],
  ["activity", "/activity"],
  ["audit", "/activity?tab=audit"],
  ["settings", "/settings"],
];
const WIDTHS = readme ? [1440, 390] : [390, 768, 1280, 1440];
const THEMES = ["light", "dark"];
const RUNS = readme ? ["S1", "S2", "S3", "S5"] : ["S2"];

const browser = await chromium.launch();
const problems = [];

async function shot(name, url, width, theme, prepare) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: theme, locale: "en-IN", timezoneId: "Asia/Kolkata", deviceScaleFactor: readme && name.startsWith("run-") ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + url, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const file = path.join(out, `${name}-${width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: !readme });
  if (errors.length || overflow > 0) problems.push(`${name} ${width} ${theme}: ${overflow > 0 ? `overflow ${overflow}px ` : ""}${errors.join(" | ")}`);
  console.log(`${file}${overflow > 0 ? `  OVERFLOW ${overflow}px` : ""}${errors.length ? `  ${errors.length} console errors` : ""}`);
  await ctx.close();
}

for (const [name, url] of PAGES) for (const w of WIDTHS) for (const t of THEMES) await shot(name, url, w, t);

for (const id of RUNS) {
  for (const w of readme ? [1440] : [1440, 390]) {
    for (const t of readme ? ["light"] : THEMES) {
      await shot(`run-${id.toLowerCase()}`, `/?demo=${id}`, w, t, async (page) => {
        await page.getByText(/Kaam poora|Batch roka gaya|Kaam roka gaya/).first().waitFor({ timeout: 60_000 });
        if (readme) await page.locator("#run-title").scrollIntoViewIfNeeded();
      });
    }
  }
}

await browser.close();
console.log(problems.length ? `\nProblems:\n  ${problems.join("\n  ")}` : "\nNo console errors, no horizontal overflow.");
