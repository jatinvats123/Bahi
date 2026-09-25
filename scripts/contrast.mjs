// WCAG contrast report for the colour tokens in src/app/globals.css.
// Usage: npm run contrast. Exits 1 if any required pair fails.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum, note]
const TEXT = 4.5;
const LARGE = 3;
const pairs = [
  ["ink", "paper", TEXT], ["ink", "paper-raised", TEXT], ["ink", "paper-sunk", TEXT],
  ["ink-soft", "paper", TEXT], ["ink-soft", "paper-raised", TEXT], ["ink-soft", "paper-sunk", TEXT],
  ["ink-faint-text", "paper", TEXT], ["ink-faint-text", "paper-raised", TEXT],
  ["bahi-ink", "paper", TEXT], ["bahi-ink", "paper-raised", TEXT],
  ["zari-ink", "paper-raised", TEXT],
  ["paid-ink", "paper-raised", TEXT], ["pending-ink", "paper-raised", TEXT],
  ["blocked-ink", "paper-raised", TEXT], ["approval-ink", "paper-raised", TEXT], ["expired-ink", "paper-raised", TEXT],
  ["paid-ink", "paper", TEXT], ["pending-ink", "paper", TEXT], ["blocked-ink", "paper", TEXT], ["approval-ink", "paper", TEXT],
  ["on-bahi", "bahi-fill", TEXT, "primary button"],
  ["cloth-ink", "cloth", TEXT], ["cloth-ink", "cloth-deep", TEXT], ["cloth-ink-soft", "cloth", TEXT],
  ["cloth-stitch", "cloth", LARGE, "wordmark + stitch"],
  ["focus", "paper", LARGE, "focus ring (non-text 3:1)"], ["focus", "paper-raised", LARGE, "focus ring"],
  ["bahi-fill", "paper", LARGE, "mic button vs page (non-text)"],
];

const themes = { light: block(":root"), dark: { ...block(":root"), ...block(':root[data-theme="dark"]') } };
let failures = 0;
for (const [name, tokens] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min, note = ""] of pairs) {
    if (!tokens[fg] || !tokens[bg]) {
      console.log(`  ??   ${fg} on ${bg}: token missing`);
      failures++;
      continue;
    }
    const r = ratio(tokens[fg], tokens[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}  ${fg} on ${bg} (min ${min}) ${note}`);
  }
}
console.log(failures ? `\n${failures} pair(s) below target.` : "\nAll pairs meet their target.");
process.exit(failures ? 1 : 0);
