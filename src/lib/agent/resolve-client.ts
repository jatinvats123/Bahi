import type { Client } from "../ledger";

/**
 * Resolve how the owner names a client ("sharma ji", "Verma wale", "gupta electronics",
 * a typo like "sharmaa") to exactly one client from the directory. Never invents one:
 * anything uncertain comes back as candidates for the agent to ask about.
 * Pure module, unit tested.
 */

/** What resolving needs: names only, so the browser can resolve without client emails. */
export type ClientName = Pick<Client, "id" | "name" | "aliases" | "contact">;

export type ClientResolution<C extends ClientName = Client> =
  | { status: "matched"; client: C; score: number; via: string }
  | { status: "ambiguous"; candidates: { client: C; score: number }[] }
  | { status: "not_found"; candidates: { client: C; score: number }[] };

/** Honorifics and Hinglish particles that are never part of a client name. */
const STOP = new Set([
  "ji", "jee", "sahab", "saab", "sahib", "bhai", "bhaiya", "madam", "sir", "mr", "mrs", "ms", "shri", "shree",
  "ko", "ke", "ka", "ki", "se", "wale", "waale", "vale", "wala", "waala", "wali", "log", "the", "and", "aur",
  "company", "co", "pvt", "ltd", "private", "limited",
]);

/** Generic business words: they help an exact match but never identify a client alone. */
const GENERIC = new Set(["traders", "trader", "sweets", "electronics", "tailors", "caterers", "store", "stores", "shop", "enterprises", "and", "sons"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

function skeleton(w: string): string {
  const folded = w.replace(/w/g, "v").replace(/(.)\1+/g, "$1");
  return folded[0] + folded.slice(1).replace(/[aeiouy]/g, "");
}

/** Similarity of two single words in [0, 1], tolerant of Hinglish spelling ("varma"/"verma"). */
function wordScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  // Hinglish spellings mostly differ in vowels and doubled letters ("varma"/"verma", "sharmaa").
  if (a.length >= 4 && b.length >= 4 && skeleton(a) === skeleton(b)) return 0.9;
  const d = levenshtein(a, b);
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return 0;
  const s = 1 - d / longest;
  return s >= 0.7 ? s : 0;
}

function scoreClient(query: string[], client: ClientName): { score: number; via: string } {
  let best = { score: 0, via: "" };
  for (const name of [client.name, ...client.aliases, client.contact]) {
    const nameTokens = tokens(name);
    if (nameTokens.length === 0) continue;
    // Exact phrase: every name token appears in the query.
    if (nameTokens.every((t) => query.includes(t))) {
      const s = 1;
      if (s > best.score) best = { score: s, via: name };
      continue;
    }
    // Distinctive tokens (not "traders") matched fuzzily.
    const distinctive = nameTokens.filter((t) => !GENERIC.has(t));
    if (distinctive.length === 0) continue;
    let sum = 0;
    for (const t of distinctive) sum += Math.max(0, ...query.map((q) => wordScore(q, t)));
    const s = (sum / distinctive.length) * 0.95;
    if (s > best.score) best = { score: s, via: name };
  }
  return best;
}

const MATCH = 0.8;
const CANDIDATE = 0.55;

export function resolveClient<C extends ClientName = Client>(clients: readonly C[], spoken: string): ClientResolution<C> {
  const query = tokens(spoken);
  if (query.length === 0) return { status: "not_found", candidates: [] };

  const byId = clients.find((c) => c.id.toLowerCase() === spoken.trim().toLowerCase());
  if (byId) return { status: "matched", client: byId, score: 1, via: "id" };

  const scored = clients
    .map((client) => ({ client, ...scoreClient(query, client) }))
    .filter((s) => s.score >= CANDIDATE)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) {
    return { status: "not_found", candidates: [] };
  }
  const second = scored[1];
  if (top.score >= MATCH && (!second || top.score - second.score >= 0.1)) {
    return { status: "matched", client: top.client, score: Number(top.score.toFixed(2)), via: top.via };
  }
  const candidates = scored.slice(0, 3).map((s) => ({ client: s.client, score: Number(s.score.toFixed(2)) }));
  return top.score >= MATCH ? { status: "ambiguous", candidates } : { status: "not_found", candidates };
}
