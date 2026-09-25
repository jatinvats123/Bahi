"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { parseRunEventLine, type RunEvent } from "@/lib/events";
import { initialRunState, runReducer } from "@/lib/run-reducer";
import type { ScenarioId } from "@/lib/scenarios";

/**
 * Starts a run with POST /api/runs and folds the NDJSON event stream into a RunView
 * as lines arrive. The server keeps a run going if the stream drops (it may be waiting
 * for an approval), so a dropped stream reattaches with GET /api/runs/:id?tail=1, and a
 * reloaded page reattaches to a run that is still live. stop() is explicit:
 * POST /api/runs/:id/stop.
 */

export type RunPhase = "idle" | "starting" | "streaming" | "done" | "stopped" | "error";

const LAST_RUN_KEY = "bahi-last-run";

function remember(runId: string | null) {
  try {
    if (runId) sessionStorage.setItem(LAST_RUN_KEY, runId);
    else sessionStorage.removeItem(LAST_RUN_KEY);
  } catch {
    // storage blocked: reattach after reload just won't happen
  }
}

async function readNdjson(body: ReadableStream<BufferSource>, onEvents: (events: RunEvent[]) => void): Promise<void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const events = lines.map(parseRunEventLine).filter((e): e is RunEvent => e !== null);
    if (events.length) onEvents(events);
  }
  const tail = parseRunEventLine(buffer);
  if (tail) onEvents([tail]);
}

export function useRun(opts: { onFinished?: () => void } = {}) {
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const stopping = useRef(false);
  const onFinished = useRef(opts.onFinished);
  useEffect(() => {
    onFinished.current = opts.onFinished;
  }, [opts.onFinished]);

  useEffect(() => () => controller.current?.abort(), []);

  const onEvents = useCallback((events: RunEvent[]) => {
    runIdRef.current ??= events[0]?.runId ?? null;
    dispatch({ type: "events", events });
  }, []);

  /** Stream the rest of a live run (after a drop or a reload). Returns false if it could not. */
  const tail = useCallback(
    async (runId: string, ctl: AbortController): Promise<boolean> => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}?tail=1`, { signal: ctl.signal, cache: "no-store" });
        if (!res.ok || !res.body) return false;
        await readNdjson(res.body, onEvents);
        return true;
      } catch {
        return false;
      }
    },
    [onEvents],
  );

  const start = useCallback(
    async (text: string, source: "text" | "voice" = "text", scenario?: ScenarioId) => {
      controller.current?.abort();
      const ctl = new AbortController();
      controller.current = ctl;
      stopping.current = false;
      runIdRef.current = null;
      dispatch({ type: "reset" });
      setProblem(null);
      setPhase("starting");

      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, source, ...(scenario ? { scenario } : {}) }),
          signal: ctl.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setProblem(body?.error ?? `Server ne mana kiya (${res.status}).`);
          setPhase("error");
          return;
        }
        runIdRef.current = res.headers.get("x-run-id");
        remember(runIdRef.current);
        setPhase("streaming");
        await readNdjson(res.body, onEvents);
        if (controller.current === ctl) setPhase("done");
      } catch (err) {
        if (ctl.signal.aborted) {
          if (controller.current === ctl) setPhase(stopping.current ? "stopped" : "done");
        } else {
          // The stream dropped but the run goes on server-side: reattach once.
          const id = runIdRef.current;
          const back = id ? await tail(id, ctl) : false;
          if (back) {
            if (controller.current === ctl) setPhase("done");
          } else {
            console.error("[run] stream failed", err);
            setProblem("Server se connection toot gaya. Activity page par dekho kya hua, phir dobara bhejo.");
            setPhase("error");
          }
        }
      } finally {
        if (controller.current === ctl) onFinished.current?.();
      }
    },
    [onEvents, tail],
  );

  // After a reload: reattach to this tab's last run if the server still has it live.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(LAST_RUN_KEY);
    } catch {
      id = null;
    }
    if (!id) return;
    const ctl = new AbortController();
    void fetch("/api/runs/live", { cache: "no-store", signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ runs: { runId: string }[] }>) : null))
      .then(async (body) => {
        if (!body?.runs.some((r) => r.runId === id) || controller.current) return;
        controller.current = ctl;
        runIdRef.current = id;
        setPhase("streaming");
        const ok = await tail(id!, ctl);
        if (controller.current === ctl) {
          setPhase(ok ? "done" : "idle");
          onFinished.current?.();
        }
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [tail]);

  const stop = useCallback(() => {
    stopping.current = true;
    const id = runIdRef.current;
    // Tell the server first (the run would otherwise keep going), then drop the stream.
    const done = () => controller.current?.abort();
    if (id) void fetch(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }).finally(() => setTimeout(done, 400));
    else done();
  }, []);

  const busy = phase === "starting" || phase === "streaming";
  return { run, view: run.view, phase, busy, problem, start, stop };
}
