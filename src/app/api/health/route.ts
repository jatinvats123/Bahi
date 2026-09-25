import { buildHealthReport, type HealthReport } from "@/lib/health";
import { getIntegrations } from "@/lib/integrations";

export const runtime = "nodejs";

/**
 * GET /api/health: per-integration status (ok, degraded, down), latency and a human
 * hint, from one cheap read per integration through Swytchcode. Results are reused
 * for 20 s so the Settings page cannot hammer five providers; ?fresh=1 skips that.
 */

const TTL_MS = 20_000;
let last: { at: number; report: HealthReport } | undefined;
let inflight: Promise<HealthReport> | undefined;

const respond = (report: HealthReport) => Response.json(report, { status: report.overall === "down" ? 503 : 200 });

export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (!fresh && last && Date.now() - last.at < TTL_MS) return respond(last.report);
  inflight ??= buildHealthReport(getIntegrations()).finally(() => {
    inflight = undefined;
  });
  const report = await inflight;
  last = { at: Date.now(), report };
  return respond(report);
}
