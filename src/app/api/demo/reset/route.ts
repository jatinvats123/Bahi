import { getEnv } from "@/lib/env";
import { resetMockWorld } from "@/lib/integrations/mock/world";

export const runtime = "nodejs";

/**
 * POST /api/demo/reset -> reseed the mock world (ledger, inbox, invoices) from fixtures/.
 * Mock mode only: live sandbox data is real history (Notion, PayPal) and is never wiped from here.
 * Run history (data/runs.json) is kept either way.
 */
export async function POST() {
  if (getEnv().SWYTCH_MODE !== "mock") {
    return Response.json({ error: "Live sandbox ka data yahan se reset nahi hota. Mock mode mein hi reset hota hai." }, { status: 409 });
  }
  resetMockWorld();
  return Response.json({ ok: true, message: "Mock data fixtures se dobara bhar diya." });
}
