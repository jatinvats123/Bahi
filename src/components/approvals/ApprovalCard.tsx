"use client";

import { CheckIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Stamp } from "@/components/ui/Stamp";
import type { ApprovalStatus } from "@/lib/events";
import { formatINR, formatTimeIST } from "@/lib/format";
import type { StampKind } from "@/lib/run-reducer";

/** What the card needs; filled from a timeline entry or from GET /api/approvals. */
export interface ApprovalCardData {
  approvalId: string | null;
  status: ApprovalStatus;
  via: "bahi" | "swytchcode" | null;
  client: string | null;
  amountInr: number | null;
  description: string | null;
  policyId: string | null;
  channel: string;
  explain: string | null;
  expiresAt: string | null;
  since: string;
  by: string | null;
  /** Fallback line when details are missing (older runs). */
  summary?: string;
}

const STAMP: Record<ApprovalStatus, StampKind> = { pending: "awaiting", approved: "approved", denied: "denied", expired: "expired" };

function useCountdown(until: string | null, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, until]);
  if (!active || !until) return null;
  const left = Math.max(0, Math.round((Date.parse(until) - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/**
 * The approval card: AWAITING stamp while a large invoice waits, then APPROVED, DENIED
 * or EXPIRED slams in. Approve / deny buttons act on Bahi's approval desk
 * (POST /api/approvals/:id); the waiting run picks the decision up within a second.
 */
export function ApprovalCard({
  data,
  compact = false,
  onDecided,
  readOnly = false,
}: {
  data: ApprovalCardData;
  compact?: boolean;
  onDecided?: () => void;
  /** A recorded run: the decision comes from the recording, so no buttons. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<ApprovalStatus | null>(null);
  const status = data.status !== "pending" ? data.status : (localStatus ?? "pending");
  const pending = status === "pending";
  const countdown = useCountdown(data.expiresAt, pending);
  const canDecide = pending && !readOnly && data.via !== "swytchcode" && Boolean(data.approvalId);

  async function decide(decision: "approve" | "deny") {
    if (!data.approvalId) return;
    setBusy(decision);
    setProblem(null);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(data.approvalId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; record?: { status: ApprovalStatus } | null } | null;
      if (!res.ok) {
        setProblem(body?.error ?? "Faisla save nahi hua. Dobara koshish karein.");
        if (body?.record?.status && body.record.status !== "pending") setLocalStatus(body.record.status);
      } else {
        setLocalStatus(decision === "approve" ? "approved" : "denied");
        onDecided?.();
      }
    } catch {
      setProblem("Server tak pahunch nahi paaye.");
    } finally {
      setBusy(null);
    }
  }

  const headline = data.client && data.amountInr !== null ? `${data.client}, ${formatINR(data.amountInr)}` : (data.summary ?? "Bada invoice");

  return (
    <div data-approval-id={data.approvalId ?? undefined} className={`rounded-bahi border ${pending ? "border-pending/50 bg-pending/5" : "border-rule bg-paper-raised"} ${compact ? "p-3.5" : "mt-3 p-4"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-serif leading-snug text-ink ${compact ? "text-[16px]" : "text-[18px]"}`}>{headline}</p>
          {data.description ? <p className="mt-0.5 text-[13px] text-ink-soft">{data.description}</p> : null}
        </div>
        <Stamp kind={STAMP[status]} size={compact ? "sm" : "md"} className="mt-0.5 shrink-0" />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {data.policyId ? (
          <Chip tone="approval" mono icon={<ShieldCheckIcon size={13} weight="duotone" aria-hidden />}>
            {data.policyId}
          </Chip>
        ) : null}
        <Chip mono>Slack {data.channel}</Chip>
        {countdown ? <Chip tone="pending" mono>{countdown} baaki</Chip> : null}
        {!pending && data.by ? <Chip>{data.by}</Chip> : null}
      </div>

      {data.explain && !compact ? <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-soft">{data.explain}</p> : null}

      {pending ? (
        readOnly ? (
          <p className="mt-3 text-[13px] text-pending-ink">Recorded run: owner ka faisla recording se aayega.</p>
        ) : data.via === "swytchcode" ? (
          <p className="mt-3 text-[13px] font-semibold text-pending-ink">Slack pe approve karein ({data.channel}).</p>
        ) : canDecide ? (
          <div className="mt-3">
            <p className="text-[13px] text-ink-soft">
              Slack {data.channel} mein bheja gaya. <span className="font-semibold text-ink">Yahan approve karein</span> ya Slack wale link se.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void decide("approve")} data-approve>
                <CheckIcon size={15} weight="bold" aria-hidden />
                {busy === "approve" ? "Approve ho raha hai" : "Approve karein"}
              </Button>
              <Button size="sm" disabled={busy !== null} onClick={() => void decide("deny")}>
                <XIcon size={15} weight="bold" aria-hidden />
                {busy === "deny" ? "Mana ho raha hai" : "Mana karein"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-pending-ink">Approval ka intezaar.</p>
        )
      ) : (
        <p className="mt-2.5 text-[12.5px] text-ink-soft">
          {status === "approved" ? "Approve hua. Invoice aage bheja gaya." : status === "denied" ? "Mana kiya gaya. PayPal tak kuch nahi gaya." : "Samay khatam. PayPal tak kuch nahi gaya."}
          <span className="num ml-1.5 text-ink-faint-text">{formatTimeIST(data.since)}</span>
        </p>
      )}
      {problem ? (
        <p role="alert" className="mt-2 text-[13px] text-blocked-ink">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
