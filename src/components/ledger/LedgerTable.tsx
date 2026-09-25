"use client";

import { ArrowSquareOutIcon, KanbanIcon, MagnifyingGlassIcon, PaypalLogoIcon, XIcon } from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
import { Chip, ChipButton, type ChipTone } from "@/components/ui/Chip";
import { CopyId } from "@/components/ui/CopyId";
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

function matches(inv: Invoice, q: string): boolean {
  if (!q) return true;
  const hay = `${inv.clientName} ${inv.description} ${inv.id} ${inv.jiraKey ?? ""} ${inv.amountInr}`.toLowerCase();
  return q
    .toLowerCase()
    .replace(/[₹,]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

function jiraHref(base: string | null, key: string): string | null {
  return base ? `${base.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}` : null;
}

function Links({ inv, jiraBaseUrl }: { inv: Invoice; jiraBaseUrl: string | null }) {
  const jira = inv.jiraKey ? jiraHref(jiraBaseUrl, inv.jiraKey) : null;
  if (!inv.payUrl && !inv.jiraKey) return <span className="text-ink-faint-text">Nahi</span>;
  const link = "inline-flex items-center gap-1 rounded text-[12.5px] font-semibold text-bahi-ink underline-offset-4 hover:underline";
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {inv.payUrl ? (
        <a href={inv.payUrl} target="_blank" rel="noreferrer" className={link} aria-label={`PayPal sandbox invoice ${inv.id} (naye tab mein)`}>
          <PaypalLogoIcon size={14} weight="duotone" aria-hidden />
          PayPal
          <ArrowSquareOutIcon size={12} aria-hidden />
        </a>
      ) : null}
      {inv.jiraKey ? (
        jira ? (
          <a href={jira} target="_blank" rel="noreferrer" className={link} aria-label={`Jira task ${inv.jiraKey} (naye tab mein)`}>
            <KanbanIcon size={14} weight="duotone" aria-hidden />
            <span className="num">{inv.jiraKey}</span>
            <ArrowSquareOutIcon size={12} aria-hidden />
          </a>
        ) : (
          <span className="num inline-flex items-center gap-1 text-[12.5px] text-ink-soft">
            <KanbanIcon size={14} weight="duotone" aria-hidden />
            {inv.jiraKey}
          </span>
        )
      ) : null}
    </span>
  );
}

export function LedgerTable({ invoices, today, jiraBaseUrl = null }: { invoices: Invoice[]; today: string; jiraBaseUrl?: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;
  const searched = invoices.filter((i) => matches(i, q));
  const rows = searched.filter(active.match);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div role="group" aria-label="Status filter" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <ChipButton key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="num text-[11px] opacity-75">{searched.filter(f.match).length}</span>
            </ChipButton>
          ))}
        </div>
        <div className="w-full lg:w-[300px]">
          <label htmlFor="ledger-search" className="mb-1.5 block text-[13px] font-semibold text-ink-soft">
            Dhoondho
          </label>
          <div className="relative">
            <MagnifyingGlassIcon size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint-text" />
            <input
              id="ledger-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Client, kaam, invoice ya Jira"
              autoComplete="off"
              className="h-10 w-full rounded-bahi border border-rule bg-paper-raised pr-9 pl-9 text-sm text-ink placeholder:text-ink-faint-text focus-visible:border-ink-faint [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Search saaf karo"
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-soft hover:text-ink"
              >
                <XIcon size={14} weight="bold" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 border-y border-rule py-8 text-center">
          <p className="text-sm text-ink-soft">{q ? `"${q}" se koi invoice nahi mila.` : "Is filter mein koi invoice nahi."}</p>
          {q || filter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="mt-2 rounded text-[13px] font-semibold text-bahi-ink underline-offset-4 hover:underline"
            >
              Sab dikhao
            </button>
          ) : null}
        </div>
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
                  <TH>Reminder</TH>
                  <TH className="pr-4">Links</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((inv) => (
                  <TR key={inv.id} className="hover:bg-paper/60">
                    <TD className="pl-4">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <span className="num text-[12.5px] text-ink">{inv.id}</span>
                        <CopyId value={inv.id} />
                      </span>
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
                    <TD className="whitespace-nowrap">
                      {inv.lastReminderOn ? (
                        <span className="num text-[12.5px] text-ink-soft">{keyDate(inv.lastReminderOn)}</span>
                      ) : (
                        <span className="text-ink-faint-text">Nahi</span>
                      )}
                    </TD>
                    <TD className="pr-4 whitespace-nowrap">
                      <Links inv={inv} jiraBaseUrl={jiraBaseUrl} />
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
                  <span className="inline-flex items-center gap-0.5">
                    <span className="num text-[11.5px] text-ink-faint-text">{inv.id}</span>
                    <CopyId value={inv.id} />
                  </span>
                </div>
                {inv.payUrl || inv.jiraKey ? (
                  <div className="mt-2">
                    <Links inv={inv} jiraBaseUrl={jiraBaseUrl} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
