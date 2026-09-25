"use client";

import { FastForwardIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { RunTimeline } from "@/components/command/RunTimeline";
import type { RunEvent } from "@/lib/events";
import { initialRunState, runReducer } from "@/lib/run-reducer";

/** Real gaps between events, squeezed so a two-minute run replays in a few seconds. */
const MIN_GAP_MS = 90;
const MAX_GAP_MS = 650;

/**
 * Replays a stored run through the same reducer and timeline as the live console,
 * so the owner sees the steps arrive in order. Reduced motion shows everything at once.
 */
export function RunReplay({ events }: { events: RunEvent[] }) {
  const reduce = useReducedMotion();
  const [run, dispatch] = useReducer(runReducer, initialRunState);
  const [playing, setPlaying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const showAll = useCallback(() => {
    clear();
    dispatch({ type: "reset" });
    dispatch({ type: "events", events });
    setPlaying(false);
  }, [clear, events]);

  const play = useCallback(() => {
    clear();
    dispatch({ type: "reset" });
    if (reduce) {
      dispatch({ type: "events", events });
      return;
    }
    setPlaying(true);
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    let at = 0;
    sorted.forEach((event, i) => {
      const prev = sorted[i - 1];
      const gap = prev ? Date.parse(event.ts) - Date.parse(prev.ts) : 0;
      at += i === 0 ? 0 : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, gap));
      timers.current.push(
        setTimeout(() => {
          dispatch({ type: "event", event });
          if (i === sorted.length - 1) setPlaying(false);
        }, at),
      );
    });
  }, [clear, events, reduce]);

  useEffect(() => {
    const t = setTimeout(play, 250);
    return () => {
      clearTimeout(t);
      clear();
    };
  }, [play, clear]);

  return (
    <div>
      <RunTimeline view={run.view} playing={playing} canReplay onReplay={play} label="Purana run, dobara" />
      {playing ? (
        <div className="after-margin mt-3">
          <button
            type="button"
            onClick={showAll}
            className="inline-flex items-center gap-1.5 rounded px-1 text-[13px] font-semibold text-bahi-ink underline-offset-4 hover:underline"
          >
            <FastForwardIcon size={14} weight="fill" aria-hidden />
            Seedha poora dikhao
          </button>
        </div>
      ) : null}
    </div>
  );
}
