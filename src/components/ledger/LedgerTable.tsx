"use client";

import { useState } from "react";
import { Chip, ChipButton, type ChipTone } from "@/components/ui/Chip";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatDateIST, formatINR } from "@/lib/format";
import { INVOICE_STATUS_LABEL, type Invoice, type InvoiceStatus } from "@/lib/ledger";

const STATUS_TONE: Record<InvoiceStatus, ChipTone> = {
  paid: "paid",
  sent: "approval",
  overdue: "blocked",
  draft: "neutral",
  awaiting_approval: "pending",
  cancelled: "expired",
  refunded: "expired",
};

type Filter = "all" | "open" | "overdue" | "paid" | "draft";
const FILTERS: { id: Filter; label: string; match: (i: Invoice) => boolean }[] = [
  { id: "all", label: "Sab", match: () => true },
  { id: "open", label: "Aana baaki", match: (i) => i.status === "sent" || i.status === "overdue" },
  { id: "overdue", label: "Late", match: (i) => i.status === "overdue" },
  { id: "paid", label: "Paid", match: (i) => i.status === "paid" },
  { id: "draft", label: "Draft", match: (i) => i.status === "draft" || i.status === "awaiting_approval" },
];

/** "2026-09-26" keys are IST calendar days; parse at UTC noon to stay clear of DST/offset edges. */
function dayDiff(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000);
}

function keyDate(key: string): string {
  return formatDateIST(`${key}T12:00:00+05:30`);
}

function DueCell({ inv, today }: { inv: Invoice; today: string }) {
  if (inv.status === "paid" && inv.paidOn) {
    return <span className="text-paid-ink">{inv.paidOn === today ? "Aaj mila" : `${keyDate(inv.paidOn)} ko mila`}</span>;
  }
  const late = dayDiff(inv.dueOn, today);
  if (inv.status === "overdue" && late > 0) {
    return (
      <span>
        <span className="font-semibold text-blocked-ink">{late} din late</span>
        <span className="num ml-1.5 text-[11.5px] text-ink-faint-text">{keyDate(inv.dueOn)}</span>
      </span>
    );
  }
  return <span className="num text-ink-soft">{keyDate(inv.dueOn)}</span>;
}

export function LedgerTable({ invoices, today }: { invoices: Invoice[]; today: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;
  const rows = invoices.filter(active.match);

  return (
    <div>
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <ChipButton key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span className="num text-[11px] opacity-75">{invoices.filter(f.match).length}</span>
          </ChipButton>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 border-y border-rule py-8 text-center text-sm text-ink-soft">Is filter mein koi invoice nahi.</p>
      ) : (
        <>
          {/* md and up: ruled table */}
          <div className="paper-card mt-5 hidden overflow-x-auto md:block">
            <Table>
              <caption className="sr-only">Invoices, filter: {active.label}</caption>
              <THead>
                <tr>
                  <TH className="pl-4">Invoice</TH>
                  <TH>Client</TH>
                  <TH>Kaam</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                  <TH>Due</TH>
                  <TH className="pr-4">Reminder</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((inv) => (
                  <TR key={inv.id} className="hover:bg-paper/60">
                    <TD className="pl-4">
                      <span className="num text-[12.5px] text-ink">{inv.id}</span>
                    </TD>
                    <TD>
                      <p className="font-semibold text-ink">{inv.clientName}</p>
                      <p className="text-[12px] text-ink-faint-text">{inv.clientEmail}</p>
                    </TD>
                    <TD className="max-w-[240px] text-ink-soft">{inv.description}</TD>
                    <TD className="text-right">
                      <span className="num text-[14px] font-semibold text-ink">{formatINR(inv.amountInr)}</span>
                    </TD>
                    <TD>
                      <Chip tone={STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Chip>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <DueCell inv={inv} today={today} />
                    </TD>
                    <TD className="pr-4 whitespace-nowrap">
                      {inv.lastReminderOn ? (
                        <span className="num text-[12.5px] text-ink-soft">{keyDate(inv.lastReminderOn)}</span>
                      ) : (
                        <span className="text-ink-faint-text">Nahi</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* below md: one ledger entry per invoice */}
          <ul className="mt-5 border-t border-ink/70 md:hidden">
            {rows.map((inv) => (
              <li key={inv.id} className="border-b border-rule/70 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{inv.clientName}</p>
                    <p className="text-[13px] text-ink-soft">{inv.description}</p>
                  </div>
                  <span className="num shrink-0 text-[15px] font-semibold text-ink">{formatINR(inv.amountInr)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                  <Chip tone={STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Chip>
                  <DueCell inv={inv} today={today} />
                  <span className="num text-[11.5px] text-ink-faint-text">{inv.id}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
