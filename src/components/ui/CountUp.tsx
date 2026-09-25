"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
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
  // Where the next animation starts: 0 on mount (SSR and hydration match), the last value after that.
  const from = useRef(0);
  const fmt = format === "inr" ? formatINR : formatNumberIN;

  useEffect(() => {
    // Reduced motion: jump straight to the value (duration 0).
    const controls = animate(from.current, value, {
      duration: reduce ? 0 : duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        from.current = v;
        setShown(Math.round(v));
      },
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
