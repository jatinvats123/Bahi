import type { ReactNode } from "react";

/** Page title set right of the margin line, with an optional note in the margin. */
export function PageHeader({ title, lead, margin, actions }: { title: string; lead?: ReactNode; margin?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="margin-grid pt-8 pb-6 md:pt-12">
      <div className="flex justify-end pt-3 pr-2.5">{margin}</div>
      <div className="flex flex-wrap items-end justify-between gap-4 px-[var(--gutter)]">
        <div className="min-w-0">
          <h1 className="text-[34px] leading-[1.1] font-medium tracking-tight text-ink md:text-[44px]">{title}</h1>
          {lead ? <p className="mt-2 max-w-[62ch] text-[15px] text-ink-soft">{lead}</p> : null}
        </div>
        {actions}
      </div>
    </header>
  );
}
