"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovalStatus } from "@/lib/events";
import type { ApprovalCardData } from "./ApprovalCard";

/** Shape of one record from GET /api/approvals (see src/lib/guardrails/approvals.ts). */
interface ApiApproval {
  id: string;
  status: ApprovalStatus;
  via: "bahi" | "swytchcode";
  client: string;
  amountInr: number;
  description: string;
  policyId: string;
  channel: string;
  explain: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  by: string | null;
}

export function toCardData(a: ApiApproval): ApprovalCardData {
  return {
    approvalId: a.id,
    status: a.status,
    via: a.via,
    client: a.client,
    amountInr: a.amountInr,
    description: a.description,
    policyId: a.policyId,
    channel: a.channel,
    explain: a.explain,
    expiresAt: a.expiresAt,
    since: a.decidedAt ?? a.createdAt,
    by: a.by,
  };
}

/** Pending approvals from every run (and scripts), plus decisions from the last 15 minutes. Polls every 4 s. */
export function useApprovals(): { pending: ApprovalCardData[]; recent: ApprovalCardData[]; refresh: () => void } {
  const [state, setState] = useState<{ pending: ApprovalCardData[]; recent: ApprovalCardData[] }>({ pending: [], recent: [] });

  const refresh = useCallback(() => {
    void fetch("/api/approvals", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ pending: ApiApproval[]; recent: ApiApproval[] }>) : null))
      .then((body) => {
        if (!body) return;
        const cutoff = Date.now() - 15 * 60_000;
        setState({
          pending: body.pending.map(toCardData),
          recent: body.recent.filter((a) => a.decidedAt && Date.parse(a.decidedAt) > cutoff).slice(0, 3).map(toCardData),
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { ...state, refresh };
}
