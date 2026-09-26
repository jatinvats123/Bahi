import { setDefaultResultOrder } from "node:dns";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Scripts run outside Next.js, so load .env.local ourselves (Node's built-in
 * loader; existing process env wins). Call before importing app modules.
 */
export function loadLocalEnv(): void {
  // Same as src/instrumentation.ts: broken IPv6 must not stall model calls.
  setDefaultResultOrder("ipv4first");
  const file = path.join(process.cwd(), ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Minimal fixed-width table for terminal output (no colours, Windows-safe). */
export function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ")).join("\n");
}
