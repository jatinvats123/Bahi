"use client";

import { PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

export const CONFIRM_MS = 2500;

/**
 * Safety strip for spoken money commands: shows what Bahi understood (amount, client, action)
 * and sends it after a 2.5 s countdown unless the owner cancels or edits. Esc cancels.
 */
export function VoiceConfirm({
  transcript,
  parts,
  needsApproval,
  onConfirm,
  onCancel,
  onEdit,
}: {
  transcript: string;
  parts: string[];
  needsApproval: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const reduce = useReducedMotion();
  const [left, setLeft] = useState(Math.ceil(CONFIRM_MS / 1000));
  const handlers = useRef({ onConfirm, onCancel });
  useEffect(() => {
    handlers.current = { onConfirm, onCancel };
  });

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((CONFIRM_MS - (Date.now() - started)) / 1000))), 200);
    const done = setTimeout(() => handlers.current.onConfirm(), CONFIRM_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handlers.current.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const R = 15;
  const C = 2 * Math.PI * R;

  return (
    <motion.div
      role="alertdialog"
      aria-labelledby="voice-confirm-title"
      aria-describedby="voice-confirm-said"
      data-testid="voice-confirm"
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-bahi border border-pending/55 bg-pending/8 px-3.5 py-3"
    >
      <span className="relative inline-flex size-10 shrink-0 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r={R} fill="none" strokeWidth="2.5" className="stroke-rule" />
          <circle
            cx="18"
            cy="18"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="stroke-bahi"
            strokeDasharray={C}
            style={reduce ? { strokeDashoffset: 0 } : { strokeDashoffset: 0, animation: `confirm-ring ${CONFIRM_MS}ms linear forwards`, ["--ring-c" as string]: C }}
          />
        </svg>
        <span className="num text-[13px] font-semibold text-ink">{left}</span>
      </span>

      <div className="min-w-0 flex-1 basis-[220px]">
        <p id="voice-confirm-title" className="text-[13px] font-semibold text-pending-ink">
          Samjha. {left} second mein bhej rahe hain
        </p>
        <p className="num mt-0.5 text-[15px] font-semibold text-ink">{parts.length ? parts.join(" · ") : "Hukum"}</p>
        <p id="voice-confirm-said" className="mt-0.5 truncate font-serif text-[14px] text-ink-soft italic">
          &ldquo;{transcript}&rdquo;{needsApproval ? <span className="not-italic"> (approval lagega)</span> : null}
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={onEdit}>
          <PencilSimpleIcon size={15} weight="bold" aria-hidden />
          Badlo
        </Button>
        <Button size="sm" onClick={onCancel}>
          <XIcon size={15} weight="bold" aria-hidden />
          Roko
        </Button>
      </div>
    </motion.div>
  );
}
