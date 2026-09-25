import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ChipTone = "neutral" | "paid" | "pending" | "blocked" | "approval" | "zari" | "bahi" | "expired";

const tones: Record<ChipTone, string> = {
  neutral: "border-rule bg-paper-raised text-ink-soft",
  paid: "border-paid/40 bg-paid/8 text-paid-ink",
  pending: "border-pending/45 bg-pending/10 text-pending-ink",
  blocked: "border-blocked/40 bg-blocked/8 text-blocked-ink",
  approval: "border-approval/40 bg-approval/8 text-approval-ink",
  zari: "border-zari/50 bg-zari/10 text-zari-ink",
  bahi: "border-bahi/35 bg-bahi/6 text-bahi-ink",
  expired: "border-rule bg-paper-sunk text-expired-ink",
};

const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap";

export function chipClasses(tone: ChipTone = "neutral", mono = false): string {
  return `${base} ${tones[tone]} ${mono ? "num text-[11.5px]" : ""}`;
}

export function Chip({
  tone = "neutral",
  mono = false,
  icon,
  children,
  className = "",
}: {
  tone?: ChipTone;
  mono?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${chipClasses(tone, mono)} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

/** Interactive chip (example commands, filters). */
export function ChipButton({
  pressed,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`${base} cursor-pointer text-[13px] transition-colors duration-150 active:translate-y-px ${
        pressed
          ? "border-ink bg-ink text-paper"
          : "border-rule bg-paper-raised text-ink-soft hover:border-ink-faint hover:text-ink"
      } ${className}`}
      {...rest}
    />
  );
}
