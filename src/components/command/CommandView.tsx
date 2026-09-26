"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApprovals } from "@/components/approvals/useApprovals";
import { Skeleton, LedgerRowSkeleton, LedgerSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DEMO_EVENT, isInteractiveTarget, isTextTarget, type DemoRunDetail } from "@/components/ui/keys";
import { useSpeech } from "@/hooks/useSpeech";
import { useVoice } from "@/hooks/useVoice";
import { setVoicePrefs } from "@/hooks/voice-prefs";
import type { ClientName } from "@/lib/agent/resolve-client";
import { formatINR } from "@/lib/format";
import type { Hisaab } from "@/lib/ledger";
import { getScenario, isScenarioId, type ScenarioId } from "@/lib/scenarios";
import { understandCommand, type Understood } from "@/lib/voice/understood";
import { CommandBar } from "./CommandBar";
import { ExampleChips } from "./ExampleChips";
import { RightRail, type BriefState } from "./RightRail";
import { RunTimeline } from "./RunTimeline";
import { useRun } from "./useRun";
import { VoiceConfirm } from "./VoiceConfirm";

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

// ---------------------------------------------------------------- command history (Up arrow)

const HISTORY_KEY = "bahi-command-history";

function readHistory(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function pushHistory(text: string) {
  try {
    const next = [text, ...readHistory().filter((h) => h !== text)].slice(0, 20);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: recall works for nothing, sending still works
  }
}

// ---------------------------------------------------------------- greeting

function Greeting({ businessName, brief }: { businessName: string; brief: BriefState }) {
  return (
    <div className="text-[13.5px] text-ink-soft">
      <p className="font-semibold text-ink-soft">Namaste, {businessName}</p>
      <div className="mt-0.5 min-h-[20px]" aria-live="polite">
        {brief.status === "ready" ? (
          <p data-testid="greeting-hisaab">
            Aaj <span className="num font-semibold text-ink">{formatINR(brief.hisaab.toReceive)}</span> aana baaki hai
            {brief.hisaab.overdue > 0 ? (
              <>
                , <span className="num font-semibold text-blocked-ink">{formatINR(brief.hisaab.overdue)}</span> late
              </>
            ) : null}
            {brief.hisaab.receivedToday > 0 ? (
              <>
                , aaj <span className="num font-semibold text-paid-ink">{formatINR(brief.hisaab.receivedToday)}</span> aaya
              </>
            ) : null}
            .
          </p>
        ) : brief.status === "loading" ? (
          <Skeleton className="mt-1 h-3.5 w-64 max-w-full" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Command console: the owner's command (typed or spoken) goes to POST /api/runs and every step
 * streams back into the ledger-style timeline. Spoken money commands get a 2.5 s confirm strip
 * first. `speak` events are read aloud (never on page load). The right rail reads GET /api/brief
 * and refreshes after each run.
 */
export function CommandView({
  businessName,
  approvalThresholdInr,
  approvalsChannel,
  clients,
}: {
  businessName: string;
  approvalThresholdInr: number;
  approvalsChannel: string;
  /** Names and aliases only (for the voice confirm strip). */
  clients: ClientName[];
}) {
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState<BriefState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<{ transcript: string; understood: Understood } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recallIndex = useRef(-1);
  const toast = useToast();

  const retryBrief = useRef<() => void>(() => undefined);
  const loadBrief = useCallback(
    async (fresh: boolean): Promise<void> => {
      setRefreshing(true);
      const next = await fetchBrief(fresh);
      // Keep showing the last good numbers if a refresh fails.
      setBrief((prev) => (next.status === "error" && prev.status === "ready" ? prev : next));
      setRefreshing(false);
      if (next.status === "error") {
        toast.show({ tone: "error", title: "Hisaab padh nahi paaye", body: next.message, action: { label: "Dobara padho", onClick: () => retryBrief.current() } });
      }
    },
    [toast],
  );

  useEffect(() => {
    retryBrief.current = () => void loadBrief(true);
  }, [loadBrief]);

  // First read on mount; setState happens in the promise callback, not in the effect body.
  useEffect(() => {
    let alive = true;
    void fetchBrief(false).then((b) => {
      if (!alive) return;
      setBrief(b);
      if (b.status === "error") {
        toast.show({ tone: "error", title: "Hisaab padh nahi paaye", body: b.message, action: { label: "Dobara padho", onClick: () => retryBrief.current() } });
      }
    });
    return () => {
      alive = false;
    };
  }, [toast]);

  const { view, phase, busy, problem, start, stop } = useRun({ onFinished: () => void loadBrief(true) });
  const desk = useApprovals();
  const speech = useSpeech();

  // ---- spoken replies: only for runs started from this tab, never on load or reattach
  const speakFrom = useRef<number | null>(null);
  useEffect(() => {
    if (speakFrom.current === null) return;
    const fresh = view.spoken.slice(speakFrom.current);
    if (fresh.length === 0) return;
    speakFrom.current = view.spoken.length;
    for (const line of fresh) speech.speak(line);
  }, [view.spoken, speech]);

  // A run started from this tab: if its timeline begins below the fold (phones, short screens),
  // bring it into view so the owner sees the steps arrive.
  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = timelineRef.current;
    if (!view.runId || speakFrom.current === null || !el) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.7) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [view.runId]);

  const run = useCallback(
    (text: string, source: "text" | "voice", scenario?: ScenarioId) => {
      if (busy) return;
      speech.cancel();
      setConfirm(null);
      speakFrom.current = 0;
      recallIndex.current = -1;
      pushHistory(text);
      void start(text, source, scenario);
      setInput("");
    },
    [busy, speech, start],
  );

  useEffect(() => {
    if (phase === "stopped") toast.show({ title: "Run rok diya", body: "Jo kadam ho chuke the woh ho gaye. Poora record Activity page par hai." });
  }, [phase, toast]);

  // ---- voice input
  const voice = useVoice({
    onInterim: (text) => setInput(text),
    onFinal: (text) => {
      setInput(text);
      const understood = understandCommand(text, clients, approvalThresholdInr);
      if (understood.money) setConfirm({ transcript: text, understood });
      else run(text, "voice");
    },
    onError: (message, code) => toast.show({ title: code === "no-speech" ? "Kuch sunai nahi diya" : "Awaaz mein dikkat", body: message }),
  });

  const onMicToggle = useCallback(() => {
    if (busy) return;
    speech.cancel();
    setConfirm(null);
    voice.toggle();
  }, [busy, speech, voice]);

  // ---- page shortcuts: "/" focus, Esc quiet, hold Space to talk
  const spaceHeld = useRef(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        speech.cancel();
        if (voice.state !== "idle") voice.cancel();
        return;
      }
      if (e.code === "Space" && !e.repeat && !spaceHeld.current && voice.supported && !busy && !confirm && !isInteractiveTarget(e.target)) {
        e.preventDefault();
        spaceHeld.current = true;
        speech.cancel();
        voice.start();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeld.current) {
        e.preventDefault();
        spaceHeld.current = false;
        voice.stop();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [speech, voice, busy, confirm]);

  // ---- demo controls (Ctrl+Shift+D): run a scenario here, or arrive with ?demo=S1 from another page
  useEffect(() => {
    const onDemo = (e: Event) => {
      const id = (e as CustomEvent<DemoRunDetail>).detail?.scenario;
      if (isScenarioId(id)) run(getScenario(id).command, "text", id);
    };
    window.addEventListener(DEMO_EVENT, onDemo);
    return () => window.removeEventListener(DEMO_EVENT, onDemo);
  }, [run]);

  const arrivedWithDemo = useRef(false);
  useEffect(() => {
    if (arrivedWithDemo.current) return;
    arrivedWithDemo.current = true;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("demo");
    if (!isScenarioId(id)) return;
    url.searchParams.delete("demo");
    window.history.replaceState(null, "", url.pathname + url.search);
    window.dispatchEvent(new CustomEvent<DemoRunDetail>(DEMO_EVENT, { detail: { scenario: id } }));
  }, []);

  // ---- ?approval=<id> (the link in the Slack approval message, often opened on a phone):
  // bring that card into view and focus Approve, since on small screens the rail sits below the fold.
  const approvalLinkDone = useRef(false);
  useEffect(() => {
    if (approvalLinkDone.current) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("approval");
    if (!id) {
      approvalLinkDone.current = true;
      return;
    }
    const card = document.querySelector<HTMLElement>(`[data-approval-id="${CSS.escape(id)}"]`);
    if (!card) return; // not loaded yet: try again when the desk refreshes
    approvalLinkDone.current = true;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.querySelector<HTMLButtonElement>("[data-approve]")?.focus({ preventScroll: true });
    url.searchParams.delete("approval");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [desk.pending, desk.recent]);

  const onRecall = useCallback(() => {
    const history = readHistory();
    if (history.length === 0) return null;
    recallIndex.current = Math.min(recallIndex.current + 1, history.length - 1);
    return history[recallIndex.current] ?? null;
  }, []);

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 pt-8 pb-16 md:pt-12">
        <div className="after-margin">
          <Greeting businessName={businessName} brief={brief} />
          <h1 className="mt-2 text-[34px] leading-[1.1] font-medium tracking-tight text-ink md:text-[44px]">
            <label htmlFor="command-input">Kya karna hai?</label>
          </h1>
          <div className="mt-5 max-w-[860px]">
            <CommandBar
              value={input}
              onChange={(v) => {
                setInput(v);
                if (confirm) setConfirm(null);
              }}
              onSubmit={(text) => run(text, "text")}
              inputRef={inputRef}
              onRecall={onRecall}
              busy={busy}
              onStop={stop}
              mic={{
                supported: voice.supported,
                state: voice.state,
                onToggle: onMicToggle,
                attachLevel: voice.attachLevel,
                lang: voice.lang,
                onLang: (lang) => setVoicePrefs({ lang }),
              }}
              speaker={{ supported: speech.supported, muted: speech.muted, onToggleMute: () => setVoicePrefs({ muted: !speech.muted }) }}
            />
            {confirm ? (
              <VoiceConfirm
                transcript={confirm.transcript}
                parts={confirm.understood.parts}
                needsApproval={confirm.understood.needsApproval}
                onConfirm={() => run(confirm.transcript, "voice")}
                onCancel={() => {
                  setConfirm(null);
                  setInput("");
                }}
                onEdit={() => {
                  setConfirm(null);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              />
            ) : (
              <ExampleChips onPick={(c) => {
                setInput(c);
                inputRef.current?.focus();
              }} disabled={busy} />
            )}
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

        <div ref={timelineRef} className="max-w-[calc(860px+var(--margin-x)+2*var(--gutter))] scroll-mt-4">
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
            pendingReadOnly={view.replay !== null}
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
