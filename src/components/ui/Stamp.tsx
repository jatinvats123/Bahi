"use client";

import { motion, useReducedMotion } from "motion/react";
import type { StampKind } from "@/lib/run-reducer";

const LABEL: Record<StampKind, string> = {
  approved: "Approved",
  blocked: "Blocked",
  sent: "Sent",
  awaiting: "Awaiting",
  denied: "Denied",
  expired: "Expired",
};

const COLOR: Record<StampKind, string> = {
  approved: "text-approval-ink",
  blocked: "text-blocked-ink",
  sent: "text-paid-ink",
  awaiting: "text-pending-ink",
  denied: "text-blocked-ink",
  expired: "text-expired-ink",
};

const SIZE = {
  sm: "px-2 py-1 text-[10.5px]",
  md: "px-2.5 py-1.5 text-xs",
  lg: "px-3.5 py-2 text-[15px] tracking-[0.18em]",
} as const;

export const STAMP_LABEL = LABEL;

/**
 * Rubber stamp. Slams in (scale 1.4 -> 1, settle at -6deg, ink blur settles) whenever
 * `kind` changes. Static under prefers-reduced-motion or when animate=false.
 */
export function Stamp({
  kind,
  size = "md",
  animate = true,
  className = "",
}: {
  kind: StampKind;
  size?: keyof typeof SIZE;
  animate?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const still = !animate || reduce;
  return (
    <motion.span
      key={kind}
      className={`stamp ${SIZE[size]} ${COLOR[kind]} ${className}`}
      style={{ rotate: -6 }}
      initial={still ? false : { scale: 1.4, opacity: 0, filter: "blur(1.5px)" }}
      animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
      transition={{
        scale: { duration: 0.18, ease: [0.3, 1.25, 0.5, 1] },
        opacity: { duration: 0.08 },
        filter: { duration: 0.22, ease: "easeOut" },
      }}
    >
      {LABEL[kind]}
    </motion.span>
  );
}
