"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LedgerRowSkeleton, LedgerSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { Hisaab } from "@/lib/ledger";
import { CommandBar, type MicState } from "./CommandBar";
import { ExampleChips } from "./ExampleChips";
import { RightRail, type BriefState } from "./RightRail";
import { RunTimeline } from "./RunTimeline";
import { useApprovals } from "@/components/approvals/useApprovals";
import { useRun } from "./useRun";

interface BriefResponse extends Hisaab {
  asOf: string;
}

async function fetchBrief(fresh: boolean): Promise<BriefState> {
  try {
    const res = await fetch(`/api/brief${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
    const body = (await res.json()) as BriefResponse | { error: string };
    if (!res.ok || "error" in body) return { status: "error", message: "error" in body ? body.error : "Server ne jawab nahi diya." };
    return { status: "ready", hisaab: body, asOf: body.asOf };
  } catch {
    return { status: "error", message: "Server tak pahunch nahi paaye." };
  }
}

/**
 * Command console: the owner's command goes to POST /api/runs and every step streams
 * back into the ledger-style timeline. The right rail reads GET /api/brief and
 * refreshes after each run.
 */
export function CommandView({
  businessName,
  approvalThresholdInr,
  approvalsChannel,
}: {
  businessName: string;
  approvalThresholdInr: number;
  approvalsChannel: string;
}) {
  const [input, setInput] = useState("");
  const [mic, setMic] = useState<MicState>("idle");
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  // First read on mount; setState happens in the promise callback, not in the effect body.
  useEffect(() => {
    let alive = true;
    void fetchBrief(false).then((b) => {
      if (alive) setBrief(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  const loadBrief = useCallback(async (fresh: boolean) => {
    setRefreshing(true);
    const next = await fetchBrief(fresh);
    // Keep showing the last good numbers if a refresh fails.
    setBrief((prev) => (next.status === "error" && prev.status === "ready" ? prev : next));
    setRefreshing(false);
  }, []);

  const { view, phase, busy, problem, start, stop } = useRun({ onFinished: () => void loadBrief(true) });
  const desk = useApprovals();

  useEffect(() => {
    if (phase === "stopped") toast.show({ title: "Run rok diya", body: "Jo kadam ho chuke the woh ho gaye. Poora record Activity page par hai." });
  }, [phase, toast]);

  useEffect(
    () => () => {
      if (micTimer.current) clearTimeout(micTimer.current);
    },
    [],
  );

  // Esc stops listening from anywhere on the page.
  useEffect(() => {
    if (mic !== "listening") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMic("idle");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mic]);

  function submit(text: string) {
    if (busy) return;
    void start(text, "text");
    setInput("");
  }

  // Voice is designed but not wired yet (phase 5). The states are real; transcription is not.
  function onMic() {
    if (mic === "idle") {
      setMic("listening");
      return;
    }
    if (mic === "listening") {
      setMic("processing");
      micTimer.current = setTimeout(() => {
        setMic("idle");
        toast.show({ title: "Awaaz abhi judi nahi hai", body: "Voice phase 5 mein aayegi. Abhi type karke bhejo." });
      }, 1200);
    }
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 pt-8 pb-16 md:pt-12">
        <div className="after-margin">
          <p className="text-[13px] font-semibold text-ink-soft">Namaste, {businessName}</p>
          <h1 className="mt-1 text-[34px] leading-[1.1] font-medium tracking-tight text-ink md:text-[44px]">
            <label htmlFor="command-input">Kya karna hai?</label>
          </h1>
          <div className="mt-5 max-w-[860px]">
            <CommandBar value={input} onChange={setInput} onSubmit={submit} micState={mic} onMic={onMic} busy={busy} onStop={stop} />
            <ExampleChips onPick={setInput} disabled={busy} />
            {problem ? (
              <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-blocked-ink">
                <WarningCircleIcon size={18} aria-hidden className="mt-px shrink-0" />
                <span>
                  {problem}{" "}
                  <Link href="/activity" className="font-semibold underline underline-offset-4">
                    Activity
                  </Link>
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="max-w-[calc(860px+var(--margin-x)+2*var(--gutter))]">
          {phase === "starting" && view.status === "idle" ? (
            <div className="mt-10 border-t border-ink/70">
              <LedgerSkeleton rows={2} label="Kaam shuru ho raha hai" />
            </div>
          ) : (
            <RunTimeline view={view} playing={busy} canReplay={false} onReplay={() => undefined} />
          )}
          {busy && view.status !== "idle" ? (
            <div role="status" aria-label="Agla kadam aa raha hai">
              <LedgerRowSkeleton />
            </div>
          ) : null}
          {phase === "stopped" ? (
            <p className="after-margin mt-3 text-[13px] text-pending-ink">
              Aapne run rok diya. Jo kadam upar dikh rahe hain woh ho chuke hain.
            </p>
          ) : null}
        </div>
      </div>

      <aside
        aria-label="Aaj ka hisaab aur approvals"
        className="border-t border-rule bg-paper-sunk px-[var(--gutter)] py-8 md:pl-[calc(var(--margin-x)+var(--gutter))] xl:border-t-0 xl:border-l xl:px-5 xl:pt-12"
      >
        <div className="max-w-[560px] xl:sticky xl:top-12">
          <RightRail
            brief={brief}
            refreshing={refreshing}
            onRetry={() => {
              setBrief({ status: "loading" });
              void loadBrief(true);
            }}
            pending={view.pendingApprovals}
            desk={desk}
            onDecided={desk.refresh}
            approvalThresholdInr={approvalThresholdInr}
            approvalsChannel={approvalsChannel}
          />
        </div>
      </aside>
    </div>
  );
}
