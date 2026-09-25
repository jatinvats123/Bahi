import { z } from "zod";
import { getApprovalStore } from "@/lib/guardrails/approvals";

export const runtime = "nodejs";

const BodySchema = z.object({ decision: z.enum(["approve", "deny"]) });

const REASON: Record<string, string> = {
  not_found: "Yeh approval nahi mila.",
  already_decided: "Is par faisla pehle hi ho chuka hai.",
  expired: "Approval ka samay khatam ho chuka hai.",
};

/**
 * POST /api/approvals/:id { decision: "approve" | "deny" } -> the owner's decision from the
 * Bahi dashboard. The waiting run picks it up within a second and continues or stops.
 * No auth: Bahi runs on the owner's own machine (never expose it publicly).
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "decision approve ya deny hona chahiye" }, { status: 400 });
  const r = await getApprovalStore().decide(id, parsed.data.decision === "approve" ? "approved" : "denied", "Owner (Bahi dashboard)");
  if (!r.ok) return Response.json({ error: REASON[r.reason] ?? "Nahi ho paya.", record: r.record ?? null }, { status: r.reason === "not_found" ? 404 : 409 });
  return Response.json({ record: r.record });
}
