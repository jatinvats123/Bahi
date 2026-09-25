import Link from "next/link";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import type { Integration } from "@/lib/events";
import { formatDateIST, formatDuration, formatTimeIST } from "@/lib/format";
import type { AuditDecision, AuditRow } from "@/lib/guardrails/audit";
import { INTEGRATION_LABEL } from "@/lib/verbs";

const DECISION: Record<AuditDecision, { label: string; tone: ChipTone }> = {
  allowed: { label: "Allowed", tone: "paid" },
  approval: { label: "Approval", tone: "approval" },
  blocked: { label: "Blocked", tone: "blocked" },
  failed: { label: "Failed", tone: "pending" },
};

const SOURCE: Record<AuditRow["source"], string> = {
  swytchcode: "Swytchcode log",
  run: "Bahi run (mock)",
  desk: "Bahi approval desk",
};

export interface AuditFilters {
  integration: Integration | "all";
  decision: AuditDecision | "all";
}

function href(f: AuditFilters): string {
  const q = new URLSearchParams({ tab: "audit" });
  if (f.integration !== "all") q.set("integration", f.integration);
  if (f.decision !== "all") q.set("decision", f.decision);
  return `/activity?${q.toString()}`;
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-20 text-[12.5px] font-semibold text-ink-soft">{label}</span>
      {children}
    </div>
  );
}

function FilterLink({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap transition-colors ${active ? "border-ink bg-ink text-paper" : "border-rule bg-paper-raised text-ink-soft hover:border-ink-faint hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}

/**
 * Audit tab: every Swytchcode decision (allowed, held for approval, blocked) merged with
 * Bahi's run events and approval desk. Retries appear only when Swytchcode's log shows
 * more than one HTTP attempt.
 */
export function AuditTable({ rows, filters, note, swytchcodeAvailable }: { rows: AuditRow[]; filters: AuditFilters; note: string | null; swytchcodeAvailable: boolean }) {
  const shown = rows.filter((r) => (filters.integration === "all" || r.integration === filters.integration) && (filters.decision === "all" || r.decision === filters.decision));
  const blockedNoNetwork = rows.filter((r) => r.decision === "blocked" && r.noNetwork).length;
  const held = rows.filter((r) => r.decision === "approval").length;
  const integrations: (Integration | "all")[] = ["all", "paypal", "gmail", "slack", "notion", "jira"];
  const decisions: (AuditDecision | "all")[] = ["all", "allowed", "approval", "blocked", "failed"];

  return (
    <section aria-labelledby="audit-title" className="after-margin max-w-[1100px]">
      <h2 id="audit-title" className="sr-only">
        Audit
      </h2>
      <p className="max-w-[70ch] text-[14px] text-ink-soft">
        Har bahari call Swytchcode se hokar jaati hai. Yahan Swytchcode ka apna audit log ({rows.length} entries) Bahi ke runs aur approval desk ke saath mila kar dikhaya gaya hai.{" "}
        <span className="font-semibold text-ink">{blockedNoNetwork}</span> calls network se pehle hi ruki, <span className="font-semibold text-ink">{held}</span> approval ke liye ruki.
      </p>
      {!swytchcodeAvailable ? <p className="mt-2 text-[13px] text-pending-ink">Swytchcode audit log abhi khaali hai (mock mode mein sirf Bahi runs dikhte hain).</p> : null}
      {note ? <p className="mt-2 text-[13px] text-pending-ink">{note}</p> : null}

      <div className="mt-5 space-y-2.5">
        <FilterRow label="Integration">
          {integrations.map((i) => (
            <FilterLink key={i} active={filters.integration === i} to={href({ ...filters, integration: i })}>
              {i === "all" ? "Sab" : INTEGRATION_LABEL[i]}
            </FilterLink>
          ))}
        </FilterRow>
        <FilterRow label="Faisla">
          {decisions.map((d) => (
            <FilterLink key={d} active={filters.decision === d} to={href({ ...filters, decision: d })}>
              {d === "all" ? "Sab" : DECISION[d].label}
            </FilterLink>
          ))}
        </FilterRow>
      </div>

      {shown.length === 0 ? (
        <div className="mt-6 border-t border-ink/70 pt-5">
          <p className="font-serif text-lg text-ink">Is filter mein koi entry nahi.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Doosra filter chuno, ya{" "}
            <Link href="/activity?tab=audit" className="font-semibold text-bahi-ink underline underline-offset-4">
              sab dikhao
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-bahi border border-rule bg-paper-raised">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <caption className="sr-only">Swytchcode audit, newest first</caption>
            <thead>
              <tr className="border-b border-rule text-[12px] text-ink-soft">
                <th scope="col" className="px-3 py-2.5 font-semibold">Time</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Tool</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Faisla</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Nateeja</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Latency</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Run</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.source}-${r.id}-${i}`} className="border-b border-rule/50 align-top last:border-b-0">
                  <td className="num px-3 py-2 whitespace-nowrap text-ink-soft">
                    {formatTimeIST(r.ts, { seconds: true })}
                    <span className="block text-[11px] text-ink-faint-text">{formatDateIST(r.ts)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="num block text-[12px] break-all text-ink">{r.tool}</span>
                    <span className="text-[11.5px] text-ink-faint-text">
                      {r.integration ? INTEGRATION_LABEL[r.integration] : "Other"}, {SOURCE[r.source]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={DECISION[r.decision].tone}>{DECISION[r.decision].label}</Chip>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    <span className="block">{r.outcome}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {r.noNetwork && r.source === "swytchcode" ? <Chip mono tone="paid">provider not called</Chip> : null}
                      {r.retries ? <Chip mono tone="zari">retry x{r.retries}</Chip> : null}
                    </span>
                  </td>
                  <td className="num px-3 py-2 text-right whitespace-nowrap text-ink-soft">{r.ms !== null ? formatDuration(r.ms) : ""}</td>
                  <td className="px-3 py-2">
                    {r.runId ? (
                      <Link href={`/activity/${encodeURIComponent(r.runId)}`} className="num text-[12px] font-semibold text-bahi-ink underline-offset-4 hover:underline">
                        Run dekho
                      </Link>
                    ) : (
                      <span className="text-[12px] text-ink-faint-text">run ke bahar</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
