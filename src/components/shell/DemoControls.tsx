"use client";

import { ArrowCounterClockwiseIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { DEMO_EVENT, type DemoRunDetail } from "@/components/ui/keys";
import { useToast } from "@/components/ui/Toast";
import { useSpeech } from "@/hooks/useSpeech";
import { useSpeechSupported } from "@/hooks/useVoice";
import { SCENARIOS, type ScenarioId } from "@/lib/scenarios";

/**
 * Hidden presenter panel, Ctrl+Shift+D from any page: run S1-S6 (and S2-deny) in one click,
 * reset the mock data, and see which modes are on. Not linked from the UI on purpose.
 */
export function DemoControls({
  mode,
  agentMode,
  modelReady,
}: {
  mode: "live" | "mock";
  agentMode: "live" | "replay";
  /** At least one model key is configured (only matters when the agent runs live). */
  modelReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const reduce = useReducedMotion();
  const voiceIn = useSpeechSupported();
  const { supported: voiceOut, voiceName } = useSpeech();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) opener.current = document.activeElement;
          return !o;
        });
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  function runScenario(id: ScenarioId) {
    setOpen(false);
    if (pathname === "/") window.dispatchEvent(new CustomEvent<DemoRunDetail>(DEMO_EVENT, { detail: { scenario: id } }));
    else router.push(`/?demo=${encodeURIComponent(id)}`);
  }

  async function reset() {
    setResetting(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (res.ok) {
        toast.show({ tone: "success", title: "Demo data reset", body: body?.message });
        router.refresh();
      } else toast.show({ tone: "error", title: "Reset nahi hua", body: body?.error ?? `Server ne mana kiya (${res.status}).` });
    } catch {
      toast.show({ tone: "error", title: "Reset nahi hua", body: "Server tak pahunch nahi paaye.", action: { label: "Dobara koshish", onClick: () => void reset() } });
    } finally {
      setResetting(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="demo-title"
          data-testid="demo-controls"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="paper-card fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] left-4 z-50 max-h-[80dvh] overflow-y-auto p-4 md:bottom-6 md:left-auto md:w-[380px]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="demo-title" className="font-serif text-lg text-ink">
                Demo controls
              </h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">Ctrl+Shift+D se khulta aur band hota hai.</p>
            </div>
            <button type="button" onClick={close} aria-label="Band karo" className="-m-1 rounded p-1 text-ink-faint-text hover:text-ink">
              <XIcon size={18} aria-hidden />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {mode === "mock" ? <Chip tone="pending">Swytchcode: mock data</Chip> : <Chip tone="paid">Swytchcode: live sandbox</Chip>}
            {agentMode === "replay" ? <Chip tone="approval">Agent: recorded runs</Chip> : <Chip tone={modelReady ? "paid" : "blocked"}>{modelReady ? "Agent: live model" : "Agent: model key nahi"}</Chip>}
            <Chip tone={voiceIn ? "paid" : "neutral"}>{voiceIn ? "Mic: chalu" : "Mic: is browser mein nahi"}</Chip>
            <Chip mono>{voiceOut ? (voiceName ? `Awaaz: ${voiceName.replace(/^Microsoft |^Google /, "").slice(0, 24)}` : "Awaaz: default") : "Awaaz: nahi"}</Chip>
          </div>

          <p className="mt-4 text-[12.5px] font-semibold text-ink-soft">Scenario chalao</p>
          <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => runScenario(s.id)}
                  data-testid={`demo-${s.id}`}
                  className="flex w-full items-center gap-2 rounded-bahi border border-rule bg-paper-raised px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:border-ink-faint"
                >
                  <PlayIcon size={13} weight="fill" aria-hidden className="shrink-0 text-bahi-ink" />
                  <span className="num shrink-0 text-[11.5px] font-semibold text-ink-soft">{s.id}</span>
                  <span className="min-w-0 truncate">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-rule pt-3">
            <p className="text-[12.5px] text-ink-soft">{mode === "mock" ? "Mock ledger, inbox aur invoices fixtures se dobara." : "Live data reset nahi hota."}</p>
            <Button size="sm" onClick={() => void reset()} disabled={resetting || mode !== "mock"}>
              <ArrowCounterClockwiseIcon size={14} weight="bold" aria-hidden />
              {resetting ? "Reset ho raha hai" : "Reset demo data"}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
