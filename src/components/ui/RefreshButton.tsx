"use client";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "./Button";

/** Re-render a server page (e.g. after Notion could not be read). */
export function RefreshButton({ label = "Dobara padho" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" className="mt-4" disabled={pending} onClick={() => start(() => router.refresh())}>
      <ArrowClockwiseIcon size={14} weight="bold" aria-hidden className={pending ? "motion-safe:animate-spin" : ""} />
      {pending ? "Padh rahe hain" : label}
    </Button>
  );
}
