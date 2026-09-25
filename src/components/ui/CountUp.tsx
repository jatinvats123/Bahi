"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { formatINR, formatNumberIN } from "@/lib/format";

/**
 * Number that counts up from 0 on mount. Screen readers get the final value
 * immediately; the animated digits are aria-hidden.
 */
export function CountUp({
  value,
  format = "inr",
  duration = 0.9,
  className = "",
}: {
  value: number;
  format?: "inr" | "number";
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const fmt = format === "inr" ? formatINR : formatNumberIN;

  useEffect(() => {
    // Reduced motion: jump straight to the value (duration 0). Always start from 0 so SSR and hydration match.
    const controls = animate(0, value, {
      duration: reduce ? 0 : duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return (
    <span className={className}>
      <span aria-hidden>{fmt(shown)}</span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  );
}
