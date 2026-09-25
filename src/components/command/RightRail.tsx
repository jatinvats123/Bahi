"use client";

import { ArrowClockwiseIcon, HourglassMediumIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ApprovalCard, type ApprovalCardData } from "@/components/approvals/ApprovalCard";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CountUp } from "@/components/ui/CountUp";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatINR, formatTimeIST } from "@/lib/format";
import type { Hisaab } from "@/lib/ledger";
import type { PendingApproval } from "@/lib/run-reducer";

function Figure({ label, value, count, tone, noun }: { label: string; value: number; count: number; tone: string; noun: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule/70 px-4 py-3 last:border-b-0">
      <div>
        <p className="text-[13px] font-semibold text-ink-soft">{label}</p>
        <p className="num mt-0.5 text-[11.5px] text-ink-faint-text">
          {count} {noun}
        </p>
      </div>
      <CountUp value={value} className={`font-serif text-[28px] leading-none font-medium tracking-tight tabular-nums ${tone}`} />
    </div>
  );
}

export type BriefState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; hisaab: Hisaab; asOf: string };

function FigureSkeleton() {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule/70 px-4 py-3 last:border-b-0" aria-hidden>
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="h-7 w-24" />
    </div>
  );
}

export function RightRail({
  brief,
  onRetry,
  refreshing,
  pending,
  desk,
  onDecided,
  approvalThresholdInr,
  approvalsChannel,
  pendingReadOnly = false,
}: {
  brief: BriefState;
  onRetry: () => void;
  /** Numbers are being re-read after a run. */
  refreshing?: boolean;
  pending: PendingApproval[];
  /** Approvals from every run (GET /api/approvals): pending and recently decided. */
  desk: { pending: ApprovalCardData[]; recent: ApprovalCardData[] };
  onDecided: () => void;
  approvalThresholdInr: number;
  approvalsChannel: string;
  /** The current run is a recording: its approvals cannot be decided here. */
  pendingReadOnly?: boolean;
}) {
  const reduce = useReducedMotion();
  // The current run's pending approvals (live, from the stream) win over the polled copies.
  const live: ApprovalCardData[] = pending.map((p) => ({ ...p, summary: p.inputSummary }));
  const liveIds = new Set(live.map((p) => p.approvalId).filter(Boolean));
  const cards = [...live, ...desk.pending.filter((a) => !liveIds.has(a.approvalId)), ...desk.recent.filter((a) => !liveIds.has(a.approvalId))];
  return (
    <div className="space-y-5">
      <Card labelledBy="hisaab-title">
        <CardHeader
          id="hisaab-title"
          title="Aaj ka hisaab"
          hint={brief.status === "ready" ? `Ledger se, ${formatTimeIST(brief.asOf)} tak${refreshing ? ", update ho raha hai" : ""}` : "Ledger se"}
        />
        {brief.status === "ready" ? (
          <div aria-busy={refreshing ? true : undefined}>
            <Figure label="Aana baaki" value={brief.hisaab.toReceive} count={brief.hisaab.toReceiveCount} noun="invoices" tone="text-ink" />
            <Figure label="Late" value={brief.hisaab.overdue} count={brief.hisaab.overdueCount} noun="invoices" tone="text-blocked-ink" />
            <Figure label="Aaj aaya" value={brief.hisaab.receivedToday} count={brief.hisaab.receivedTodayCount} noun="payments" tone="text-paid-ink" />
          </div>
        ) : brief.status === "loading" ? (
          <div role="status" aria-label="Hisaab load ho raha hai">
            <FigureSkeleton />
            <FigureSkeleton />
            <FigureSkeleton />
          </div>
        ) : (
          <div className="px-4 py-4">
            <p className="flex items-start gap-2 text-sm text-ink">
              <WarningCircleIcon size={18} aria-hidden className="mt-px shrink-0 text-blocked-ink" />
              Ledger abhi padh nahi paaye.
            </p>
            <p className="mt-1 pl-[26px] text-[13px] text-ink-soft">{brief.message}</p>
            <Button size="sm" className="mt-3 ml-[26px]" onClick={onRetry}>
              <ArrowClockwiseIcon size={14} weight="bold" aria-hidden />
              Dobara padho
            </Button>
          </div>
        )}
      </Card>

      <Card labelledBy="approvals-title">
        <CardHeader
          id="approvals-title"
          title="Approval ka intezaar"
          hint={`${formatINR(approvalThresholdInr)} se upar ka invoice Swytchcode rok leta hai jab tak owner approve na kare. Suchna Slack #${approvalsChannel} mein.`}
        />
        <div aria-live="polite">
          <AnimatePresence initial={false}>
            {cards.map((c) => (
              <motion.div
                key={c.approvalId ?? c.since}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="px-3 py-2.5"
              >
                <ApprovalCard data={c} compact onDecided={onDecided} readOnly={pendingReadOnly && liveIds.has(c.approvalId)} />
              </motion.div>
            ))}
          </AnimatePresence>
          {cards.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-4 text-sm text-ink-soft">
              <HourglassMediumIcon size={16} aria-hidden className="text-ink-faint-text" />
              Koi approval baaki nahi.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
