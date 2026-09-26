"use client";

import {
  ArrowCounterClockwiseIcon,
  ArrowElbowDownRightIcon,
  BrainIcon,
  ChatTextIcon,
  EnvelopeSimpleIcon,
  KanbanIcon,
  NotebookIcon,
  NotePencilIcon,
  PaypalLogoIcon,
  PlayIcon,
  SealCheckIcon,
  ShieldWarningIcon,
  SlackLogoIcon,
  SpeakerHighIcon,
  WarningOctagonIcon,
  type Icon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { ApprovalCard } from "@/components/approvals/ApprovalCard";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CopyId } from "@/components/ui/CopyId";
import { Stamp } from "@/components/ui/Stamp";
import type { Integration, RunStatus } from "@/lib/events";
import { formatDateIST, formatDuration, formatTimeIST } from "@/lib/format";
import type { RunView, TimelineEntry, ToolEntry } from "@/lib/run-reducer";

const INTEGRATION_ICON: Record<Integration, Icon> = {
  paypal: PaypalLogoIcon,
  gmail: EnvelopeSimpleIcon,
  slack: SlackLogoIcon,
  notion: NotebookIcon,
  jira: KanbanIcon,
};

const STATUS_TEXT: Record<RunStatus | "idle", string> = {
  idle: "Taiyaar",
  running: "Chal raha hai",
  awaiting_approval: "Approval ka intezaar",
  completed: "Poora hua",
  blocked: "Rok diya gaya: policy",
  denied: "Approval nahi mila",
  expired: "Approval ka samay khatam",
  failed: "Ruk gaya",
};

const FINAL_VERB: Partial<Record<RunStatus, string>> = {
  completed: "Kaam poora",
  blocked: "Batch roka gaya",
  denied: "Kaam roka gaya",
  expired: "Kaam roka gaya",
  failed: "Kaam adhoora",
};

/** A PayPal invoice id inside a summary line, for the copy button. */
function invoiceIdIn(text: string): string | null {
  return /\bINV2(?:-[A-Z0-9]{4}){4}\b/.exec(text)?.[0] ?? null;
}

function humanLabel(label: string): string {
  return label.replace(/_/g, " ");
}

/** Plain-text line for the aria-live region. */
function announce(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "started":
      return `Kaam shuru: ${entry.command}`;
    case "intent":
      return `Samjha: ${humanLabel(entry.label)}`;
    case "thinking":
      return entry.text;
    case "tool":
      return `${entry.title}. ${entry.result?.summary ?? entry.policy?.message ?? entry.inputSummary}`;
    case "guard":
      return entry.flagged ? `Shak hua, koi action nahi: ${entry.reason}` : entry.reason;
    case "speak":
      return entry.text;
    case "final":
      return entry.summary;
    case "error":
      return `Dikkat: ${entry.message}`;
  }
}

function Margin({ ts }: { ts: string }) {
  const [time, period] = formatTimeIST(ts, { seconds: true }).split(" ");
  return (
    <div className="flex justify-end pt-[3px] pr-2.5">
      <time dateTime={ts} className="num text-right text-[11px] leading-[1.35] text-ink-faint-text">
        {time}
        <br />
        {period}
      </time>
    </div>
  );
}

function RowIcon({ icon: IconCmp, tone = "text-ink-soft" }: { icon: Icon; tone?: string }) {
  return (
    <span aria-hidden className={`mt-px flex size-7 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-raised ${tone}`}>
      <IconCmp size={16} weight="duotone" />
    </span>
  );
}

/**
 * Rows inherit "hidden" -> "show" from the list, so a batch (a reattach, a replay shown in full)
 * cascades 45 ms apart, while rows that stream in later animate on arrival. Opacity and a 6 px
 * lift only: nothing below moves, so there is no layout shift beyond the row's own height.
 */
const LIST_VARIANTS: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const ROW_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } },
};

function Row({ entry, children, icon, tone, quiet = false }: { entry: TimelineEntry; children: ReactNode; icon: Icon; tone?: string; quiet?: boolean }) {
  return (
    <motion.li
      variants={ROW_VARIANTS}
      className={`margin-grid border-b border-rule/60 ${quiet ? "py-2" : "py-3"}`}
    >
      <Margin ts={entry.ts} />
      <div className="flex min-w-0 gap-3 px-[var(--gutter)]">
        <RowIcon icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </motion.li>
  );
}

function Verb({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-serif text-[17px] leading-snug font-medium text-ink ${className}`}>{children}</p>;
}

function Detail({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`mt-0.5 text-[13.5px] leading-relaxed break-words text-ink-soft ${className}`}>{children}</p>;
}

function ToolChips({ e }: { e: ToolEntry }) {
  const chips: ReactNode[] = [];
  if (!e.policy) chips.push(<Chip key="sw">Swytchcode</Chip>);
  else if (e.policy.decision === "allowed") chips.push(<Chip key="sw" tone="paid">Swytchcode: policy ok</Chip>);
  else if (e.policy.decision === "approval_required") chips.push(<Chip key="sw" tone="approval">Swytchcode: approval chahiye</Chip>);
  else chips.push(<Chip key="sw" tone="blocked">Swytchcode: blocked</Chip>);

  // Approval details live on the ApprovalCard below the entry.
  for (const tag of e.result?.tags ?? []) {
    chips.push(
      <Chip key={`tag-${tag}`} tone="zari">
        {tag}
      </Chip>,
    );
  }
  if (e.state === "running") chips.push(<Chip key="run" tone="zari"><span className="animate-pulse">chal raha hai</span></Chip>);
  if (e.result) chips.push(<Chip key="ms" mono>{formatDuration(e.result.ms)}</Chip>);
  if (e.result && e.result.retries > 0) chips.push(<Chip key="retry" tone="zari" mono>retry x{e.result.retries}</Chip>);
  chips.push(<Chip key="tool" mono className="text-ink-faint-text">{e.tool}</Chip>);
  return <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>;
}

function Entry({ entry, status, recorded }: { entry: TimelineEntry; status: RunView["status"]; recorded: boolean }) {
  switch (entry.kind) {
    case "started":
      return (
        <Row entry={entry} icon={ChatTextIcon}>
          <Verb>Baat sun li</Verb>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip>{entry.inputMode === "voice" ? "Awaaz se" : "Likh ke"}</Chip>
            {entry.replay ? (
              <Chip tone="approval">Recorded run: {entry.replay.scenario}</Chip>
            ) : entry.mode === "mock" ? (
              <Chip tone="pending">Mock run</Chip>
            ) : (
              <Chip tone="paid">Live</Chip>
            )}
          </div>
        </Row>
      );
    case "intent":
      return (
        <Row entry={entry} icon={BrainIcon}>
          <Verb>Samjha: {humanLabel(entry.label)}</Verb>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Chip mono>
              LLM: {formatDuration(entry.ms)}
            </Chip>
            <Chip mono>{Math.round(entry.confidence * 100)}% yakeen</Chip>
          </div>
        </Row>
      );
    case "thinking":
      return (
        <Row entry={entry} icon={NotePencilIcon} quiet>
          <p className="pt-1 font-serif text-[15px] leading-relaxed text-ink-soft italic">{entry.text}</p>
        </Row>
      );
    case "tool": {
      const IconCmp = INTEGRATION_ICON[entry.integration];
      const tone =
        entry.state === "blocked" || entry.state === "denied" ? "text-blocked-ink"
        : entry.state === "awaiting" ? "text-pending-ink"
        : entry.state === "ok" ? "text-ink"
        : "text-ink-soft";
      const policyNote = entry.policy && entry.policy.decision !== "allowed" ? entry.policy.message : null;
      return (
        <Row entry={entry} icon={IconCmp} tone={tone}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Verb>{entry.title}</Verb>
              <Detail>
                <span className="font-semibold text-ink">{entry.integrationLabel}</span>
                <span aria-hidden> / </span>
                {entry.inputSummary}
                {invoiceIdIn(entry.inputSummary) ? <CopyId value={invoiceIdIn(entry.inputSummary)!} /> : null}
              </Detail>
            </div>
            {entry.stamp ? <Stamp kind={entry.stamp} size="sm" className="mt-1" /> : null}
          </div>
          {policyNote ? (
            <Detail className={entry.state === "blocked" || entry.state === "denied" ? "text-blocked-ink" : entry.state === "awaiting" ? "text-pending-ink" : ""}>{policyNote}</Detail>
          ) : null}
          {entry.result && entry.result.summary !== entry.title ? (
            <Detail className="flex items-start gap-1.5 text-ink">
              <ArrowElbowDownRightIcon size={14} className="mt-1 shrink-0 text-ink-faint-text" aria-hidden />
              <span>{entry.result.summary}</span>
            </Detail>
          ) : null}
          {entry.approval ? (
            <ApprovalCard
              data={{
                ...entry.approval,
                summary: entry.inputSummary,
                status: entry.approval.status,
              }}
              readOnly={recorded}
            />
          ) : null}
          <ToolChips e={entry} />
        </Row>
      );
    }
    case "guard":
      return (
        <Row entry={entry} icon={ShieldWarningIcon} tone={entry.flagged ? "text-blocked-ink" : "text-paid-ink"}>
          <Verb>{entry.flagged ? "Shak hua: koi action nahi" : "Guard: sab theek"}</Verb>
          <Detail>{entry.reason}</Detail>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={entry.flagged ? "blocked" : "paid"}>{entry.source === "llm" ? "LLM guard" : "Rules"}</Chip>
          </div>
        </Row>
      );
    case "speak":
      return (
        <Row entry={entry} icon={SpeakerHighIcon} tone="text-bahi-ink">
          <Verb>Bola</Verb>
          <p className="mt-1 border-l-2 border-bahi/50 pl-3 font-serif text-[16px] leading-relaxed text-ink italic">{entry.text}</p>
        </Row>
      );
    case "final":
      return (
        <Row entry={entry} icon={SealCheckIcon} tone={status === "completed" ? "text-paid-ink" : "text-blocked-ink"}>
          <Verb>{(status !== "idle" && FINAL_VERB[status]) || "Kaam poora"}</Verb>
          <Detail className="text-ink">{entry.summary}</Detail>
        </Row>
      );
    case "error":
      return (
        <Row entry={entry} icon={WarningOctagonIcon} tone="text-blocked-ink">
          <Verb>Dikkat aayi</Verb>
          <Detail className="text-blocked-ink">{entry.message}</Detail>
          {entry.recoverable ? <Chip tone="zari" className="mt-2">Dobara koshish ho sakti hai</Chip> : null}
        </Row>
      );
  }
}

export function RunTimeline({
  view,
  playing,
  canReplay,
  onReplay,
  label = "Abhi ka kaam",
}: {
  view: RunView;
  playing: boolean;
  canReplay: boolean;
  onReplay: () => void;
  /** Small heading above the command, e.g. "Purana run" on a replay. */
  label?: string;
}) {
  const last = view.entries.at(-1);
  const reduce = useReducedMotion();

  if (view.status === "idle") {
    return (
      <section aria-label="Abhi ka kaam" className="mt-10">
        <div className="margin-grid">
          <div />
          <div className="px-[var(--gutter)]">
            <p className="font-serif text-xl text-ink">Abhi koi kaam nahi chal raha.</p>
            <p className="mt-1 max-w-[52ch] text-sm text-ink-soft">
              Upar likho ya bolo. Har kadam yahan khata ki entry ki tarah likha jayega, time ke saath.
            </p>
            {canReplay ? (
              <Button variant="secondary" className="mt-4" onClick={onReplay}>
                <PlayIcon size={16} weight="fill" aria-hidden />
                Demo run chalao
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="run-title" className="mt-10 overflow-x-clip">
      <header className="margin-grid pb-4">
        <div className="flex justify-end pt-1.5 pr-2.5">
          {view.startedAt ? <span className="num text-[11px] text-ink-faint-text">{formatDateIST(view.startedAt)}</span> : null}
        </div>
        <div className="relative px-[var(--gutter)]">
          <p className="text-[12.5px] font-semibold text-ink-soft">{label}</p>
          <h2 id="run-title" className="mt-1 pr-24 font-serif text-[22px] leading-tight text-ink italic md:pr-36 md:text-[28px]">
            &ldquo;{view.command ?? "..."}&rdquo;
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-soft">
            <span className="font-semibold text-ink">{STATUS_TEXT[view.status]}</span>
            {view.runId ? <span className="num text-[11.5px] text-ink-faint-text">{view.runId}</span> : null}
            {view.replay ? (
              <span
                data-testid="recorded-badge"
                className="num inline-flex items-center rounded-[3px] border-[1.5px] border-dashed border-approval px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-approval-ink uppercase"
              >
                Recorded run
              </span>
            ) : view.mode === "mock" ? (
              <Chip tone="pending">Mock run</Chip>
            ) : null}
            {view.replay ? (
              <span className="text-[12px] text-ink-soft">
                Live sandbox run, recorded <span className="num">{formatDateIST(view.replay.recordedAt)}, {formatTimeIST(view.replay.recordedAt)}</span>. Dobara chal raha hai, asli nahi.
              </span>
            ) : null}
            {canReplay && !playing ? (
              <button type="button" onClick={onReplay} className="inline-flex items-center gap-1 rounded px-1 font-semibold text-bahi-ink underline-offset-4 hover:underline">
                <ArrowCounterClockwiseIcon size={14} weight="bold" aria-hidden />
                Dobara chalao
              </button>
            ) : null}
          </div>
          {view.stamp ? (
            <div className="absolute top-3 right-[var(--gutter)]" data-testid="run-stamp">
              <Stamp kind={view.stamp} size="lg" />
            </div>
          ) : null}
        </div>
      </header>

      <motion.ol
        className="border-t border-ink/70"
        aria-label="Kaam ke kadam"
        variants={LIST_VARIANTS}
        initial={reduce ? false : "hidden"}
        animate="show"
      >
        {view.entries.map((entry) => (
          <Entry key={entry.key} entry={entry} status={view.status} recorded={view.replay !== null} />
        ))}
      </motion.ol>

      {view.missingSeqs.length > 0 ? (
        <p className="after-margin mt-2 text-[12.5px] text-pending-ink">Kuch kadam abhi pahunche nahi. List adhoori ho sakti hai.</p>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {last ? announce(last) : ""}
      </div>
    </section>
  );
}
