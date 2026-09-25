import { getLedger } from "@/lib/data";

export const runtime = "nodejs";

/** GET /api/ledger -> ledger rows from Notion (live) or the mock world (mock), as Invoices. */
export async function GET() {
  const ledger = await getLedger();
  return Response.json(ledger, { status: ledger.source === "unavailable" ? 502 : 200, headers: { "cache-control": "no-store" } });
}
