import { computeBrief, type Brief } from "@/lib/brief";
import { getIntegrations } from "@/lib/integrations";
import { ownerMessage } from "@/lib/swytch/errors";

export const runtime = "nodejs";

/**
 * GET /api/brief -> right-rail numbers (to receive, overdue, received today) from the
 * Notion ledger. Reused for 15 s; ?fresh=1 (sent after every run) skips the cache.
 * The spoken daily brief additionally verifies open invoices with PayPal.
 */

const TTL_MS = 15_000;
let last: { at: number; brief: Brief } | undefined;

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (!fresh && last && Date.now() - last.at < TTL_MS) return Response.json(last.brief);
  const r = await computeBrief(getIntegrations(), { verify: false });
  if (!r.ok) {
    console.warn("[brief] ledger read failed:", r.error.message);
    return Response.json({ error: ownerMessage(r.error, "Notion") }, { status: 502 });
  }
  last = { at: Date.now(), brief: r.value };
  return Response.json(r.value, { headers: { "cache-control": "no-store" } });
}
