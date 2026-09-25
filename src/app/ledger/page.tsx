import type { Metadata } from "next";
import { connection } from "next/server";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PageHeader } from "@/components/shell/PageHeader";
import { getPublicConfig } from "@/lib/config";
import { getLedger } from "@/lib/data";
import { formatDateIST, formatINR, istDateKey } from "@/lib/format";
import { summarizeHisaab } from "@/lib/ledger";

export const metadata: Metadata = { title: "Ledger" };

function Figure({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="text-[13px] font-semibold text-ink-soft">{label}</dt>
      <dd className={`mt-1 font-serif text-[30px] leading-none font-medium tracking-tight tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

export default async function LedgerPage() {
  await connection();
  const now = new Date();
  const config = getPublicConfig();
  const ledger = getLedger(now);
  const hisaab = summarizeHisaab(ledger.invoices, now);

  return (
    <div className="pb-16">
      <PageHeader
        title="Ledger"
        lead={`${config.businessName} ka khata. Notion ledger is ka asli source hoga; har badlav Swytchcode se hoga.`}
        margin={<span className="num text-[11px] text-ink-faint-text">{formatDateIST(now)}</span>}
      />

      <div className="after-margin max-w-[1180px]">
        {ledger.source === "unavailable" ? (
          <div className="paper-card px-5 py-6">
            <p className="font-serif text-lg text-ink">Live ledger abhi juda nahi hai.</p>
            <p className="mt-1 text-sm text-ink-soft">
              SWYTCH_MODE=live hai, par Notion ledger phase 2 mein Swytchcode se judega. Demo ke liye SWYTCH_MODE=mock rakho.
            </p>
          </div>
        ) : (
          <>
            <dl className="mb-8 grid grid-cols-1 gap-5 border-y border-rule py-5 sm:grid-cols-3">
              <Figure label="Aana baaki" value={formatINR(hisaab.toReceive)} tone="text-ink" />
              <Figure label="Late" value={formatINR(hisaab.overdue)} tone="text-blocked-ink" />
              <Figure label="Aaj aaya" value={formatINR(hisaab.receivedToday)} tone="text-paid-ink" />
            </dl>
            <LedgerTable invoices={ledger.invoices} today={istDateKey(now)} />
          </>
        )}
      </div>
    </div>
  );
}
