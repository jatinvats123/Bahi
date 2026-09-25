import { getApprovalStore } from "@/lib/guardrails/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/approvals -> pending approvals first, then the 20 most recent decisions. */
export async function GET() {
  const all = await getApprovalStore().list();
  const pending = all.filter((a) => a.status === "pending");
  const recent = all.filter((a) => a.status !== "pending").slice(0, 20);
  return Response.json({ pending, recent });
}
