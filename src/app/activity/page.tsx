import { EnvelopeSimpleIcon, KanbanIcon, NotebookIcon, PaypalLogoIcon, SlackLogoIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { Stamp } from "@/components/ui/Stamp";
import { getRunHistory } from "@/lib/data";
import type { Integration, RunEvent } from "@/lib/events";
import { dayLabelIST, formatDuration, formatTimeIST, istDateKey } from "@/lib/format";
import type { RunRecord } from "@/lib/run-record";
import { foldRunEvents } from "@/lib/run-reducer";
import { INTEGRATION_LABEL } from "@/lib/verbs";

export const metadata: Metadata = { title: "Activity" };

const ICON = { paypal: PaypalLogoIcon, gmail: EnvelopeSimpleIcon, slack: SlackLogoIcon, notion: NotebookIcon, jira: KanbanIcon } as const;

const STATUS_TEXT: Record<RunRecord["status"], string> = {
  running: "Chal raha tha",
  awaiting_approval: "Approval baaki",
  completed: "Poora hua",
  blocked: "Policy ne roka",
  denied: "Approval nahi mila",
  expired: "Approval expire hua",
  failed: "Ruk gaya",
};

/** Technical one-liner per event for the audit table. */
function eventSummary(e: RunEvent): string {
  switch (e.type) {
    case "run_started":
      return `${e.inputMode}, ${e.mode}: ${e.command}`;
    case "intent":
      return `${e.source} ${e.label} (${Math.round(e.confidence * 100)}%, ${e.ms} ms)`;
    case "thinking":
      return e.text;
    case "tool_call":
      return `${e.callId} ${e.tool}: ${e.inputSummary}`;
    case "tool_result":
      return `${e.callId} ${e.ok ? "ok" : "failed"} in ${e.ms} ms, retries ${e.retries}: ${e.summary}`;
    case "policy":
      return `${e.callId} ${e.decision} [${e.policyId}] ${e.message}`;
    case "approval":
      return `${e.callId} ${e.status} in ${e.channel}${e.by ? ` by ${e.by}` : ""}`;
    case "guard":
      return `${e.flagged ? "FLAGGED" : "clear"} (${e.source}): ${e.reason}`;
    case "speak":
      return e.text;
    case "final":
      return e.summary;
    case "error":
      return `${e.recoverable ? "recoverable" : "fatal"}: ${e.message}`;
  }
}

function RunRow({ run }: { run: RunRecord }) {
  const view = foldRunEvents(run.events);
  const integrations = [...new Set(run.events.flatMap((e) => (e.type === "tool_call" ? [e.integration] : [])))] as Integration[];
  const toolCalls = run.events.filter((e) => e.type === "tool_call").length;
  const duration = run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
  const [time, period] = formatTimeIST(run.startedAt).split(" ");

  return (
    <li className="margin-grid border-b border-rule/70 py-4">
      <div className="flex justify-end pt-1 pr-2.5">
        <time dateTime={run.startedAt} className="num text-right text-[11px] leading-[1.35] text-ink-faint-text">
          {time}
          <br />
          {period}
        </time>
      </div>
      <div className="min-w-0 px-[var(--gutter)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-serif text-[18px] leading-snug text-ink italic">&ldquo;{run.command}&rdquo;</p>
            <p className="mt-1 text-[13.5px] text-ink-soft">
              <span className="font-semibold text-ink">{STATUS_TEXT[run.status]}.</span> {view.final ?? view.error?.message ?? ""}
            </p>
          </div>
          {view.stamp ? <Stamp kind={view.stamp} size="sm" animate={false} className="mt-1 shrink-0" /> : null}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {integrations.map((i) => {
            const IconCmp = ICON[i];
            return (
              <Chip key={i} icon={<IconCmp size={13} weight="duotone" aria-hidden />}>
                {INTEGRATION_LABEL[i]}
              </Chip>
            );
          })}
          <Chip mono>{toolCalls} tool calls</Chip>
          {duration !== null ? <Chip mono>{formatDuration(duration)}</Chip> : null}
          {view.guardFlagged ? <Chip tone="blocked">Guard flagged</Chip> : null}
          {run.mode === "mock" ? <Chip tone="pending">Mock</Chip> : null}
        </div>

        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[13px] font-semibold text-bahi-ink underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            <span className="transition-transform group-open:rotate-90" aria-hidden>
              &rsaquo;
            </span>
            Technical detail ({run.events.length} events)
          </summary>
          <div className="mt-2 overflow-x-auto rounded-bahi border border-rule bg-paper-raised">
            <table className="w-full text-left text-[12px]">
              <caption className="sr-only">Events for {run.runId}</caption>
              <thead>
                <tr className="border-b border-rule text-ink-soft">
                  <th scope="col" className="px-3 py-2 font-semibold">seq</th>
                  <th scope="col" className="px-3 py-2 font-semibold">time</th>
                  <th scope="col" className="px-3 py-2 font-semibold">type</th>
                  <th scope="col" className="px-3 py-2 font-semibold">detail</th>
                </tr>
              </thead>
              <tbody className="num">
                {run.events.map((e) => (
                  <tr key={e.seq} className="border-b border-rule/50 align-top last:border-b-0">
                    <td className="px-3 py-1.5 text-ink-faint-text">{e.seq}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink-soft">{formatTimeIST(e.ts, { seconds: true })}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ink">{e.type}</td>
                    <td className="min-w-[280px] px-3 py-1.5 text-ink-soft">{eventSummary(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="num border-t border-rule px-3 py-1.5 text-[11px] text-ink-faint-text">{run.runId}</p>
          </div>
        </details>
      </div>
    </li>
  );
}

export default async function ActivityPage() {
  await connection();
  const now = new Date();
  const { source, runs } = await getRunHistory(now);

  const groups = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const key = istDateKey(run.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  return (
    <div className="pb-16">
      <PageHeader
        title="Activity"
        lead="Har run ka poora record: kya samjha, kaunsa tool chala, policy ne kya kaha, aur nateeja."
      />

      {source === "fixtures" ? (
        <p className="after-margin -mt-2 mb-6 text-[13px] text-pending-ink">Ye sample runs hain (mock data). Asli runs phase 3 se yahan save honge.</p>
      ) : null}

      {runs.length === 0 ? (
        <div className="after-margin">
          <p className="font-serif text-lg text-ink">Abhi tak koi run nahi.</p>
          <p className="mt-1 text-sm text-ink-soft">Command page se pehla kaam do. Har kadam yahan likha jayega.</p>
        </div>
      ) : (
        [...groups.entries()].map(([key, dayRuns]) => (
          <section key={key} aria-labelledby={`day-${key}`} className="mb-8">
            <h2 id={`day-${key}`} className="after-margin pb-2 font-serif text-[20px] font-medium text-ink">
              {dayLabelIST(dayRuns[0]?.startedAt ?? now, now)}
            </h2>
            <ol className="max-w-[calc(980px+var(--margin-x))] border-t border-ink/70">
              {dayRuns.map((run) => (
                <RunRow key={run.runId} run={run} />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
