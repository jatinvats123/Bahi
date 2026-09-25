"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/** Small copy button for an id (invoice ids in the ledger and the timeline). */
export function CopyId({ value, label = "Invoice id" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure origin or permission): select-and-copy still works on the text.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? `${label} copy ho gaya` : `${label} ${value} copy karo`}
      title={copied ? "Copy ho gaya" : "Copy karo"}
      data-testid="copy-id"
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] align-middle text-ink-faint-text transition-colors hover:bg-paper-sunk hover:text-ink"
    >
      {copied ? <CheckIcon size={13} weight="bold" aria-hidden className="text-paid-ink" /> : <CopyIcon size={13} weight="bold" aria-hidden />}
    </button>
  );
}
