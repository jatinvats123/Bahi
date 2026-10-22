import { getEnv } from "@/lib/env";
import { getRunBus } from "@/lib/store/run-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs/live -> runs still going in this server (for reattaching after a reload).
 * ?id=<runId> asks about one run. The public demo answers only that, so visitors never see
 * (or stop) each other's runs.
 */
export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const live = getRunBus().live();
  if (id) return Response.json({ runs: live.filter((r) => r.runId === id) });
  return Response.json({ runs: getEnv().DEMO_PUBLIC ? [] : live });
}
