import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getClients } from "./fixtures";
import { ClientSchema, type Client } from "./ledger";

/**
 * Client directory. fixtures/clients.json is committed with placeholder emails;
 * data/clients.local.json (gitignored) overrides real demo addresses by client id:
 *   [{ "id": "cl_sharma", "email": "you+sharma@gmail.com", "paypalEmail": "sb-xxx@personal.example.com" }]
 */

const LOCAL_FILE = path.join(process.cwd(), "data", "clients.local.json");
const OverrideSchema = z.array(ClientSchema.partial().extend({ id: z.string() }));

let cached: Client[] | undefined;

export function getClientDirectory(): Client[] {
  if (cached) return cached;
  const base = getClients();
  if (!existsSync(LOCAL_FILE)) return (cached = base);
  const overrides = new Map(OverrideSchema.parse(JSON.parse(readFileSync(LOCAL_FILE, "utf8"))).map((o) => [o.id, o]));
  cached = base.map((c) => {
    const o = overrides.get(c.id);
    return o ? ClientSchema.parse({ ...c, ...o }) : c;
  });
  return cached;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(ji|sahab|saab|bhai)\b/g, "")
    .replace(/[^a-z0-9ऀ-ॿ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resolve a spoken or typed name ("Sharma ji ko") to a client. Longest alias match wins. */
export function matchClient(clients: readonly Client[], text: string): Client | null {
  const hay = ` ${norm(text)} `;
  let best: { client: Client; len: number } | null = null;
  for (const c of clients) {
    for (const alias of [c.name, ...c.aliases]) {
      const a = norm(alias);
      if (a && hay.includes(` ${a} `) && (!best || a.length > best.len)) best = { client: c, len: a.length };
    }
  }
  return best?.client ?? null;
}
