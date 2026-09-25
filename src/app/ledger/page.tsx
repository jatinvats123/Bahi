import type { Metadata } from "next";
import { connection } from "next/server";
import { LedgerTable } from "@/components/ledger/LedgerTable";
import { PageHeader } from "@/components/shell/PageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
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
  const ledger = await getLedger(now);
  const hisaab = summarizeHisaab(ledger.invoices, now);

  return (
    <div className="pb-16">
      <PageHeader
        title="Ledger"
        lead={`${config.businessName} ka khata. Notion ledger asli source hai; har badlav Swytchcode se hota hai.`}
        margin={<span className="num text-[11px] text-ink-faint-text">{formatDateIST(now)}</span>}
      />

      <div className="after-margin max-w-[1180px]">
        {ledger.source === "unavailable" ? (
          <div className="paper-card px-5 py-6">
            <p className="font-serif text-lg text-ink">Notion ledger padh nahi paaye.</p>
            <p className="mt-1 text-sm text-ink-soft">
              Settings mein Notion ka status dekho, ya npm run setup:notion chalao. Demo ke liye SWYTCH_MODE=mock rakho.
            </p>
            {ledger.problem ? <p className="num mt-2 text-[12px] break-words text-ink-faint-text">{ledger.problem}</p> : null}
            <RefreshButton />
          </div>
        ) : (
          <>
            <dl className="mb-8 grid grid-cols-1 gap-5 border-y border-rule py-5 sm:grid-cols-3">
              <Figure label="Aana baaki" value={formatINR(hisaab.toReceive)} tone="text-ink" />
              <Figure label="Late" value={formatINR(hisaab.overdue)} tone="text-blocked-ink" />
              <Figure label="Aaj aaya" value={formatINR(hisaab.receivedToday)} tone="text-paid-ink" />
            </dl>
            <LedgerTable invoices={ledger.invoices} today={istDateKey(now)} jiraBaseUrl={config.jiraBaseUrl} />
          </>
        )}
      </div>
    </div>
  );
}
