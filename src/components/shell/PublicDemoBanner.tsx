import { FilmStripIcon } from "@phosphor-icons/react/ssr";

/** DEMO_PUBLIC=1: on every page, so the public demo is never mistaken for a live business. */
export function PublicDemoBanner() {
  return (
    <div role="note" data-testid="public-demo-banner" className="flex items-center gap-2 border-b border-approval/50 bg-paper-sunk px-[var(--gutter)] py-2 text-[13px] text-ink">
      <FilmStripIcon size={16} weight="bold" aria-hidden className="shrink-0 text-approval-ink" />
      <span>
        <span className="font-semibold">Public demo: recorded runs on mock data.</span> Nothing you type reaches a model, PayPal, Gmail, Slack, Notion or Jira.
      </span>
    </div>
  );
}
