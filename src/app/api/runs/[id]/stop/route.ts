import { getRunBus } from "@/lib/store/run-bus";

export const runtime = "nodejs";

/** POST /api/runs/:id/stop -> the owner pressed Roko. A waiting approval expires with the run. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const stopped = getRunBus().stop(id);
  return Response.json({ stopped }, { status: stopped ? 200 : 404 });
}
