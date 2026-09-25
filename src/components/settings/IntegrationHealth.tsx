"use client";

import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  KanbanIcon,
  NotebookIcon,
  PaypalLogoIcon,
  SlackLogoIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { Integration } from "@/lib/events";
import { formatTimeIST } from "@/lib/format";
import type { HealthReport, HealthStatus, IntegrationHealth as Check } from "@/lib/health";

/** Live integration cards for Settings. Reads GET /api/health; "Dobara jaanchen" forces a fresh check. */

const META: Record<Integration, { icon: Icon; name: string; does: string }> = {
  paypal: { icon: PaypalLogoIcon, name: "PayPal (sandbox)", does: "Invoice banana, bhejna, status dekhna. Refund policy ke peeche." },
  gmail: { icon: EnvelopeSimpleIcon, name: "Gmail", does: "Inbox padhna, clients ko reminder bhejna." },
  slack: { icon: SlackLogoIcon, name: "Slack", does: "Team updates, alerts, aur bade invoice ke liye approval." },
  notion: { icon: NotebookIcon, name: "Notion", does: "Bahi Ledger: har invoice ki ek row. Source of truth." },
  jira: { icon: KanbanIcon, name: "Jira", does: "Payment aane par delivery task." },
};

const ORDER: Integration[] = ["paypal", "gmail", "slack", "notion", "jira"];

const STATUS: Record<HealthStatus, { label: string; dot: string; text: string }> = {
  ok: { label: "Theek", dot: "bg-paid", text: "text-paid-ink" },
  degraded: { label: "Dheema", dot: "bg-pending", text: "text-pending-ink" },
  down: { label: "Band", dot: "bg-blocked", text: "text-blocked-ink" },
};

function StatusMark({ status, mock }: { status: HealthStatus; mock: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${s.text}`}>
      <span aria-hidden className={`size-2 rounded-full ${s.dot}`} />
      {mock ? `${s.label} (mock)` : s.label}
    </span>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex max-w-full items-stretch overflow-hidden rounded-bahi border border-rule bg-paper-sunk">
      <code className="num min-w-0 flex-1 truncate px-2.5 py-1.5 text-[12.5px] text-ink">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex items-center gap-1 border-l border-rule px-2.5 text-[12px] font-semibold text-ink-soft hover:bg-paper hover:text-ink"
        aria-label={`Copy: ${command}`}
      >
        {copied ? <CheckIcon size={14} weight="bold" aria-hidden /> : <CopyIcon size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Row({ check, mock }: { check: Check; mock: boolean }) {
  const meta = META[check.integration];
  const IconCmp = meta.icon;
  return (
    <li className="flex items-start gap-3.5 border-b border-rule/70 px-4 py-3.5 last:border-b-0">
      <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-bahi border border-rule bg-paper text-ink">
        <IconCmp size={19} weight="duotone" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-semibold text-ink">{meta.name}</p>
          <StatusMark status={check.status} mock={mock} />
          <span className="num text-[12px] text-ink-faint-text">
            {check.ms} ms, {formatTimeIST(check.checkedAt, { seconds: true })}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-ink-soft">{meta.does}</p>
        <p className="num mt-1 text-[12px] break-words text-ink-faint-text">{check.detail}</p>
        {check.status !== "ok" ? (
          <>
            <p className="mt-1.5 text-[13px] text-ink">{check.hint}</p>
            {check.errorKind === "auth" ? <CopyCommand command={check.fixCommand} /> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

function SkeletonRows() {
  return (
    <ul aria-hidden>
      {ORDER.map((i) => (
        <li key={i} className="flex items-start gap-3.5 border-b border-rule/70 px-4 py-3.5 last:border-b-0">
          <Skeleton className="size-9 shrink-0 rounded-bahi" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function IntegrationHealthCard({ mode }: { mode: "live" | "mock" }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const retry = useRef<() => void>(() => undefined);

  const load = useCallback(
    async (fresh: boolean): Promise<void> => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/health${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
        setReport((await res.json()) as HealthReport);
      } catch {
        setFailed(true);
        toast.show({ tone: "error", title: "Integrations jaanch nahi paaye", body: "Server tak pahunch nahi paaye.", action: { label: "Dobara jaanchen", onClick: () => retry.current() } });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    retry.current = () => void load(true);
  }, [load]);

  useEffect(() => {
    // Initial check on mount; the fetch resolves asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  const mock = (report?.mode ?? mode) === "mock";
  const okCount = report?.integrations.filter((c) => c.status === "ok").length ?? 0;
  const byIntegration = new Map(report?.integrations.map((c) => [c.integration, c]));
  const sw = report?.swytchcode;

  return (
    <Card labelledBy="int-title">
      <CardHeader
        id="int-title"
        title="Integrations"
        hint={mock ? "Mock mode: fixtures se jawab, koi asli call nahi." : "Har check Swytchcode ke through ek chhota read call hai."}
        action={
          <Button size="sm" onClick={() => void load(true)} disabled={loading} aria-label="Integrations dobara jaanchen">
            <ArrowClockwiseIcon size={15} weight="bold" aria-hidden className={loading ? "motion-safe:animate-spin" : ""} />
            Dobara jaanchen
          </Button>
        }
      />
      <p className="sr-only" aria-live="polite">
        {loading ? "Integrations jaanch rahe hain" : report ? `${okCount} of ${report.integrations.length} integrations theek` : ""}
      </p>
      {sw && sw.problems.length > 0 ? (
        <div className="border-b border-rule bg-pending/8 px-4 py-3 text-[13px] text-ink">
          <p className="font-semibold text-pending-ink">Swytchcode setup adhoora hai</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {sw.problems.map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failed ? (
        <p className="px-4 py-4 text-sm text-blocked-ink">Health check load nahi hua. Server chal raha hai? Dobara try karein.</p>
      ) : !report ? (
        <SkeletonRows />
      ) : (
        <ul className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {ORDER.map((i) => {
            const c = byIntegration.get(i);
            return c ? <Row key={i} check={c} mock={mock} /> : null;
          })}
        </ul>
      )}
      {report && !failed ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-2.5 text-[12px] text-ink-soft">
          <Chip tone={report.overall === "ok" ? "paid" : report.overall === "degraded" ? "pending" : "blocked"}>
            {okCount}/{report.integrations.length} theek
          </Chip>
          <span className="num">Last checked {formatTimeIST(report.checkedAt, { seconds: true })}</span>
          {sw ? (
            <span className="num">
              swy {sw.transport}, mode {sw.projectMode}, tools {sw.toolsEnabled}/{sw.toolsExpected}
            </span>
          ) : null}
        </footer>
      ) : null}
    </Card>
  );
}
