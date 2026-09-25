"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { playScript } from "@/lib/demo-player";
import type { RunScript } from "@/lib/fixtures";
import type { Hisaab } from "@/lib/ledger";
import { initialRunState, runReducer } from "@/lib/run-reducer";
import { CommandBar, type MicState } from "./CommandBar";
import { ExampleChips } from "./ExampleChips";
import { RightRail } from "./RightRail";
import { RunTimeline } from "./RunTimeline";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Command console. Phase 1: runs are played from fixture scripts (mock mode only).
 * Phase 3 replaces playScript with the NDJSON stream from the orchestrator;
 * the reducer and timeline stay the same.
 */
export function CommandView({
  businessName,
  scripts,
  demoScriptId,
  hisaab,
  approvalThresholdInr,
  approvalsChannel,
}: {
  businessName: string;
  /** Mock scripts; empty in live mode. */
  scripts: RunScript[];
  demoScriptId: string;
  hisaab: Hisaab | null;
  approvalThresholdInr: number;
  approvalsChannel: string;
}) {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [playing, setPlaying] = useState(false);
  const [input, setInput] = useState("");
  const [mic, setMic] = useState<MicState>("idle");
  const cancelRun = useRef<(() => void) | null>(null);
  const micTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  const demoScript = scripts.find((s) => s.id === demoScriptId) ?? null;

  const play = useCallback((script: RunScript) => {
    cancelRun.current?.();
    dispatch({ type: "reset" });
    setPlaying(true);
    cancelRun.current = playScript(script, {
      runId: `run_mock_${Date.now().toString(36)}`,
      onEvent: (event) => dispatch({ type: "event", event }),
      onDone: () => setPlaying(false),
    });
  }, []);

  // Auto-play the S2 demo once so the console never opens empty in mock mode.
  useEffect(() => {
    if (!demoScript) return;
    const t = setTimeout(() => play(demoScript), 700);
    return () => {
      clearTimeout(t);
      cancelRun.current?.();
    };
  }, [demoScript, play]);

  useEffect(() => () => {
    if (micTimer.current) clearTimeout(micTimer.current);
  }, []);

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
    const match = scripts.find((s) => {
      const first = s.steps[0]?.event;
      return first?.type === "run_started" && normalize(first.command) === normalize(text);
    });
    if (match) {
      play(match);
      setInput("");
      return;
    }
    toast.show({
      title: "Agent abhi juda nahi hai",
      body: "Asli agent phase 3 mein judega. Tab tak example chips se mock run dekho.",
    });
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
            <CommandBar value={input} onChange={setInput} onSubmit={submit} micState={mic} onMic={onMic} busy={playing} />
            <ExampleChips onPick={setInput} />
          </div>
        </div>

        <div className="max-w-[calc(860px+var(--margin-x)+2*var(--gutter))]">
          <RunTimeline view={run.view} playing={playing} canReplay={demoScript !== null} onReplay={() => demoScript && play(demoScript)} />
        </div>
      </div>

      <aside
        aria-label="Aaj ka hisaab aur approvals"
        className="border-t border-rule bg-paper-sunk px-[var(--gutter)] py-8 md:pl-[calc(var(--margin-x)+var(--gutter))] xl:border-t-0 xl:border-l xl:px-5 xl:pt-12"
      >
        <div className="max-w-[560px] xl:sticky xl:top-12">
          <RightRail
            hisaab={hisaab}
            pending={run.view.pendingApprovals}
            approvalThresholdInr={approvalThresholdInr}
            approvalsChannel={approvalsChannel}
          />
        </div>
      </aside>
    </div>
  );
}
