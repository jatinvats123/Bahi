import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Inbox cursor: Bahi only reads mail that arrived after this moment.
 * `npm run demo:reset` sets it, so the demo inbox holds exactly the seeded emails
 * without touching the owner's older unread mail. No file = the whole unread inbox.
 */
const CursorSchema = z.object({ after: z.iso.datetime() });

function cursorFile(): string {
  return path.join(process.cwd(), "data", "inbox-cursor.json");
}

/** Epoch seconds of the cursor, or null when none is set (or the file is unreadable). */
export function readInboxCursor(): number | null {
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(readFileSync(cursorFile(), "utf8")));
    return parsed.success ? Math.floor(Date.parse(parsed.data.after) / 1000) : null;
  } catch {
    return null;
  }
}

export function writeInboxCursor(at: Date): void {
  mkdirSync(path.dirname(cursorFile()), { recursive: true });
  writeFileSync(cursorFile(), `${JSON.stringify({ after: at.toISOString() }, null, 2)}\n`);
}
