import { getRunBus } from "@/lib/store/run-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs/live -> runs still going in this server (for reattaching after a reload). */
export function GET() {
  return Response.json({ runs: getRunBus().live() });
}
