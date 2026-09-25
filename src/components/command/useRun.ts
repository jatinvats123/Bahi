"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { parseRunEventLine, type RunEvent } from "@/lib/events";
import { initialRunState, runReducer } from "@/lib/run-reducer";

/**
 * Starts a run with POST /api/runs and folds the NDJSON event stream into a RunView
 * as lines arrive. stop() aborts the fetch; the server sees the abort and stops the agent.
 */

export type RunPhase = "idle" | "starting" | "streaming" | "done" | "stopped" | "error";

export function useRun(opts: { onFinished?: () => void } = {}) {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const onFinished = useRef(opts.onFinished);
  useEffect(() => {
    onFinished.current = opts.onFinished;
  }, [opts.onFinished]);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (text: string, source: "text" | "voice" = "text") => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    dispatch({ type: "reset" });
    setProblem(null);
    setPhase("starting");

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setProblem(body?.error ?? `Server ne mana kiya (${res.status}).`);
        setPhase("error");
        return;
      }
      setPhase("streaming");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const events = lines.map(parseRunEventLine).filter((e): e is RunEvent => e !== null);
        if (events.length) dispatch({ type: "events", events });
      }
      const tail = parseRunEventLine(buffer);
      if (tail) dispatch({ type: "event", event: tail });
      if (controller.current === ctl) setPhase("done");
    } catch (err) {
      if (ctl.signal.aborted) {
        if (controller.current === ctl) setPhase("stopped");
      } else {
        console.error("[run] stream failed", err);
        setProblem("Server se connection toot gaya. Activity page par dekho kya hua, phir dobara bhejo.");
        setPhase("error");
      }
    } finally {
      if (controller.current === ctl) onFinished.current?.();
    }
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
  }, []);

  const busy = phase === "starting" || phase === "streaming";
  return { run, view: run.view, phase, busy, problem, start, stop };
}
