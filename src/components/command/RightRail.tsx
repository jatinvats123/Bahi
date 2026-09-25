"use client";

import { HourglassMediumIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Card, CardHeader } from "@/components/ui/Card";
import { CountUp } from "@/components/ui/CountUp";
import { Stamp } from "@/components/ui/Stamp";
import { formatINR, formatTimeIST } from "@/lib/format";
import type { Hisaab } from "@/lib/ledger";
import type { PendingApproval } from "@/lib/run-reducer";
import { INTEGRATION_LABEL } from "@/lib/verbs";

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

export function RightRail({
  hisaab,
  pending,
  approvalThresholdInr,
  approvalsChannel,
}: {
  hisaab: Hisaab | null;
  pending: PendingApproval[];
  approvalThresholdInr: number;
  approvalsChannel: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-5">
      <Card labelledBy="hisaab-title">
        <CardHeader id="hisaab-title" title="Aaj ka hisaab" hint="Ledger se, abhi tak" />
        {hisaab ? (
          <div>
            <Figure label="Aana baaki" value={hisaab.toReceive} count={hisaab.toReceiveCount} noun="invoices" tone="text-ink" />
            <Figure label="Late" value={hisaab.overdue} count={hisaab.overdueCount} noun="invoices" tone="text-blocked-ink" />
            <Figure label="Aaj aaya" value={hisaab.receivedToday} count={hisaab.receivedTodayCount} noun="payments" tone="text-paid-ink" />
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-ink-soft">Live ledger Notion se phase 2 mein judega.</p>
        )}
      </Card>

      <Card labelledBy="approvals-title">
        <CardHeader
          id="approvals-title"
          title="Approval ka intezaar"
          hint={`${formatINR(approvalThresholdInr)} se upar ke invoice Slack #${approvalsChannel} mein approve hote hain`}
        />
        <div aria-live="polite">
          <AnimatePresence initial={false}>
            {pending.map((p) => (
              <motion.div
                key={p.callId}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex items-start justify-between gap-3 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-serif text-[16px] leading-snug text-ink">{p.inputSummary}</p>
                  <p className="mt-1 text-[12.5px] text-ink-soft">
                    {INTEGRATION_LABEL[p.integration]}, Slack {p.channel}
                    <span className="num ml-1.5 text-ink-faint-text">{formatTimeIST(p.since)}</span>
                  </p>
                </div>
                <Stamp kind="awaiting" size="sm" className="mt-1 shrink-0" />
              </motion.div>
            ))}
          </AnimatePresence>
          {pending.length === 0 ? (
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
