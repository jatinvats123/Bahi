/**
 * Deterministic parser for Indian rupee amounts as owners say or type them:
 * "15,000", "₹1,50,000", "80k", "1.5 lakh", "2L", "pandrah hazaar", "sava lakh",
 * "dedh lakh", "saadhe teen hazaar", "ek lakh bees hazaar", "do hazaar paanch sau".
 *
 * The agent tools use it to check the model's number against the owner's own words.
 * Pure module: no server-only, safe for tests and the browser.
 */

const ONES: Record<number, string[]> = {
  1: ["ek", "one"],
  2: ["do", "two"],
  3: ["teen", "tin", "three"],
  4: ["char", "chaar", "four"],
  5: ["paanch", "panch", "five"],
  6: ["chhe", "chhah", "che", "chah", "chheh", "six"],
  7: ["saat", "sat", "seven"],
  8: ["aath", "ath", "eight"],
  9: ["nau", "nine"],
  10: ["das", "dus", "ten"],
  11: ["gyarah", "gyaarah", "gyara", "eleven"],
  12: ["barah", "baarah", "bara", "twelve"],
  13: ["terah", "tera", "thirteen"],
  14: ["chaudah", "chauda", "choudah", "fourteen"],
  15: ["pandrah", "pandra", "pandhrah", "fifteen"],
  16: ["solah", "sola", "sixteen"],
  17: ["satrah", "satra", "seventeen"],
  18: ["atharah", "athaarah", "athara", "eighteen"],
  19: ["unnis", "unees", "unnees", "nineteen"],
  20: ["bees", "bis", "twenty"],
  21: ["ikkis", "ikkees"],
  22: ["bais", "baees", "baaees"],
  23: ["teis", "teees"],
  24: ["chaubis", "chaubees", "choubis"],
  25: ["pachchis", "pachis", "pachees", "pachchees"],
  26: ["chhabbis", "chhabbees"],
  27: ["sattais", "sattaees"],
  28: ["atthais", "atthaees", "athais"],
  29: ["untis", "unatees", "untees"],
  30: ["tees", "tis", "thirty"],
  31: ["iktis", "ikatees"],
  32: ["battis", "battees"],
  33: ["taintis", "taintees", "tentees"],
  34: ["chauntis", "chauntees"],
  35: ["paintis", "paintees", "pentees"],
  36: ["chhattis", "chhattees"],
  37: ["saintis", "saintees"],
  38: ["adtis", "artees", "adtees"],
  39: ["untalis", "unchalis", "untalees"],
  40: ["chalis", "chaalis", "chalees", "chaalees", "forty"],
  41: ["iktalis", "iktalees"],
  42: ["bayalis", "bayalees"],
  43: ["taintalis", "taintalees", "tetalis"],
  44: ["chawalis", "chauvalis", "chawalees"],
  45: ["paintalis", "paintalees"],
  46: ["chhiyalis", "chhiyalees"],
  47: ["saintalis", "saintalees"],
  48: ["adtalis", "adtalees"],
  49: ["unchas", "unchaas"],
  50: ["pachas", "pachaas", "fifty"],
  51: ["ikyavan", "ikyawan"],
  52: ["bavan", "bawan"],
  53: ["tirpan", "trepan"],
  54: ["chauvan", "chauwan"],
  55: ["pachpan"],
  56: ["chhappan"],
  57: ["sattavan", "sattawan"],
  58: ["atthavan", "atthawan"],
  59: ["unsath", "unsaath"],
  60: ["saath", "sath", "sixty"],
  61: ["iksath", "iksaath"],
  62: ["basath", "baasath"],
  63: ["tirsath", "tresath"],
  64: ["chausath", "chausaath"],
  65: ["painsath", "painsaath"],
  66: ["chhiyasath", "chhiyasaath"],
  67: ["sadsath", "sarsath"],
  68: ["adsath", "arsath"],
  69: ["unhattar"],
  70: ["sattar", "seventy"],
  71: ["ikhattar"],
  72: ["bahattar"],
  73: ["tihattar"],
  74: ["chauhattar"],
  75: ["pachhattar", "pachattar"],
  76: ["chhihattar"],
  77: ["satattar", "sathattar"],
  78: ["athattar"],
  79: ["unasi", "unaasi"],
  80: ["assi", "assee", "asi", "eighty"],
  81: ["ikyasi", "ikyaasi"],
  82: ["bayasi", "bayaasi"],
  83: ["tirasi", "tiraasi"],
  84: ["chaurasi", "chauraasi"],
  85: ["pachasi", "pachaasi"],
  86: ["chhiyasi", "chhiyaasi"],
  87: ["sattasi", "sattaasi"],
  88: ["athasi", "athaasi"],
  89: ["navasi", "navaasi"],
  90: ["nabbe", "nabbey", "ninety"],
  91: ["ikyanve", "ikyaanve"],
  92: ["banve", "baanve"],
  93: ["tiranve", "tiraanve"],
  94: ["chauranve", "chauraanve"],
  95: ["pachanve", "pachaanve"],
  96: ["chhiyanve", "chhiyaanve"],
  97: ["sattanve", "sattaanve"],
  98: ["atthanve", "atthaanve"],
  99: ["ninyanve", "ninyaanve", "nirnave"],
};

/** Standalone fractional numbers. */
const FRACTIONS: Record<string, number> = {
  dedh: 1.5,
  dhedh: 1.5,
  dhai: 2.5,
  dhaai: 2.5,
  adhai: 2.5,
  adhaai: 2.5,
  aadha: 0.5,
  adha: 0.5,
  half: 0.5,
};

/** Words that modify the number after them. */
const MODIFIERS: Record<string, (n: number) => number> = {
  sava: (n) => n + 0.25,
  savaa: (n) => n + 0.25,
  sawa: (n) => n + 0.25,
  saadhe: (n) => n + 0.5,
  sadhe: (n) => n + 0.5,
  saade: (n) => n + 0.5,
  sade: (n) => n + 0.5,
  paune: (n) => n - 0.25,
};

/** Base value a modifier applies to when no number follows ("sava lakh" = 1.25 lakh). */
const MODIFIER_ALONE: Record<string, number> = { sava: 1.25, savaa: 1.25, sawa: 1.25, paune: 0.75 };

const BIG: Record<string, number> = {
  hazaar: 1_000,
  hazar: 1_000,
  hajaar: 1_000,
  hajar: 1_000,
  hazaaar: 1_000,
  thousand: 1_000,
  k: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  laakh: 100_000,
  l: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
  karod: 10_000_000,
  karor: 10_000_000,
  cr: 10_000_000,
};

const HUNDRED = new Set(["sau", "so", "hundred"]);

const WORD_NUM = new Map<string, number>();
for (const [n, words] of Object.entries(ONES)) for (const w of words) WORD_NUM.set(w, Number(n));
// "do" and "so" are also ordinary Hinglish words ("bhej do", "so jao"); handled by context below.
const AMBIGUOUS = new Set(["do", "so", "sat", "ath", "tis", "bis", "tin", "sath", "asi", "che", "l", "k"]);

type Token =
  | { kind: "num"; value: number; raw: string }
  | { kind: "big"; value: number; raw: string }
  | { kind: "hundred"; raw: string }
  | { kind: "mod"; fn: (n: number) => number; alone: number | null; raw: string }
  | { kind: "other"; raw: string };

function tokenize(text: string): Token[] {
  const cleaned = text
    .toLowerCase()
    // Invoice ids and similar ("INV-2026-0131") are not amounts.
    .replace(/\b[a-z]+[-_]\d[\w-]*/g, " ")
    .replace(/₹|\brs\.?|\binr\b|\brupees?\b|\brupaye?\b|\brupiya\b|\brupaiye\b/g, " ")
    // "1,50,000" and "15,000": drop grouping commas between digits.
    .replace(/(\d),(?=\d)/g, "$1")
    // "80k", "1.5l", "2cr", "15hazaar": split the suffix off the number.
    .replace(/(\d)(k|l|cr|lakh|lakhs|lac|lacs|hazaar|hazar|crore)\b/g, "$1 $2")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/-/g, " ");
  const out: Token[] = [];
  for (const raw of cleaned.split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/\.+$/, "");
    if (/^\d+(\.\d+)?$/.test(word)) out.push({ kind: "num", value: Number(word), raw: word });
    else if (word in BIG) out.push({ kind: "big", value: BIG[word]!, raw: word });
    else if (HUNDRED.has(word)) out.push({ kind: "hundred", raw: word });
    else if (word in FRACTIONS) out.push({ kind: "num", value: FRACTIONS[word]!, raw: word });
    else if (word in MODIFIERS) out.push({ kind: "mod", fn: MODIFIERS[word]!, alone: MODIFIER_ALONE[word] ?? null, raw: word });
    else if (WORD_NUM.has(word)) out.push({ kind: "num", value: WORD_NUM.get(word)!, raw: word });
    else out.push({ kind: "other", raw: word });
  }
  return out;
}

/** A tokens run is an amount only if it has a digit or a multiplier word (so "bhej do" is not 2). */
function isAmountish(run: Token[]): boolean {
  const hasDigit = run.some((t) => t.kind === "num" && /\d/.test(t.raw));
  const hasBig = run.some((t) => t.kind === "big" && !AMBIGUOUS.has(t.raw));
  const hasSuffixBig = run.some((t, i) => t.kind === "big" && AMBIGUOUS.has(t.raw) && run[i - 1]?.kind === "num");
  const hasHundred = run.some((t, i) => t.kind === "hundred" && t.raw !== "so" && run[i - 1]?.kind === "num");
  return hasDigit || hasBig || hasSuffixBig || hasHundred;
}

function evaluate(run: Token[]): number | null {
  let total = 0;
  let current: number | null = null;
  let pendingMod: ((n: number) => number) | null = null;
  let pendingAlone: number | null = null;
  let lastBig = Infinity;

  const takeNumber = (n: number) => {
    const v = pendingMod ? pendingMod(n) : n;
    pendingMod = null;
    pendingAlone = null;
    current = (current ?? 0) + v;
  };

  for (const t of run) {
    switch (t.kind) {
      case "mod":
        pendingMod = t.fn;
        pendingAlone = t.alone;
        break;
      case "num":
        takeNumber(t.value);
        break;
      case "hundred":
        current = (current ?? (pendingAlone ?? 1)) * 100;
        pendingMod = null;
        pendingAlone = null;
        break;
      case "big": {
        let base = current ?? pendingAlone ?? null;
        if (base === null) {
          if (AMBIGUOUS.has(t.raw)) return null;
          base = 1;
        }
        // "ek lakh bees hazaar": a smaller multiplier after a bigger one adds on.
        if (t.value > lastBig) total = (total + base) * t.value;
        else total += base * t.value;
        lastBig = t.value;
        current = null;
        pendingMod = null;
        pendingAlone = null;
        break;
      }
      case "other":
        break;
    }
  }
  if (current !== null) total += current;
  if (total <= 0) return null;
  return Math.round(total);
}

/** Every amount mentioned in the text, in order. "8 videos ke liye 32,000" -> [8, 32000]. */
export function extractAmounts(text: string): number[] {
  const tokens = tokenize(text);
  const out: number[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (run.length > 0 && isAmountish(run)) {
      const v = evaluate(run);
      if (v !== null) out.push(v);
    }
    run = [];
  };
  for (const t of tokens) {
    if (t.kind === "other") flush();
    else {
      // A new plain number right after a completed number starts a new amount ("8 32000").
      const prev = run.at(-1);
      if (t.kind === "num" && prev?.kind === "num" && /\d/.test(t.raw) && /\d/.test(prev.raw)) flush();
      run.push(t);
    }
  }
  flush();
  return out;
}

/** The single amount in a phrase ("pandrah hazaar" -> 15000). Null when there is none. */
export function parseAmountInr(phrase: string): number | null {
  const all = extractAmounts(phrase);
  if (all.length === 0) return null;
  // With several numbers, the biggest one is the money ("8 videos, 32000").
  return Math.max(...all);
}

/**
 * Check the model's amount against the owner's words. Returns null when it is
 * consistent (or there is nothing to check against), else a plain explanation.
 */
export function amountMismatch(amountInr: number, sources: { phrase?: string | null; command?: string | null }): string | null {
  if (sources.phrase) {
    const parsed = parseAmountInr(sources.phrase);
    if (parsed !== null && parsed !== amountInr) {
      return `The amount phrase "${sources.phrase}" means ${parsed}, not ${amountInr}.`;
    }
    if (parsed !== null) return null;
  }
  if (sources.command) {
    const said = extractAmounts(sources.command).filter((n) => n >= 100);
    if (said.length > 0 && !said.includes(amountInr)) {
      return `The owner said ${said.join(" or ")}, not ${amountInr}. Use the owner's amount.`;
    }
  }
  return null;
}
