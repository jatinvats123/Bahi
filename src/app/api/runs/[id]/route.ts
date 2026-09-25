import { getRunStore } from "@/lib/store/runs";

export const runtime = "nodejs";

/** GET /api/runs/:id -> the stored run with every event, for replay. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await getRunStore().get(id);
  if (!run) return Response.json({ error: "Yeh run nahi mila" }, { status: 404 });
  return Response.json(run);
}
