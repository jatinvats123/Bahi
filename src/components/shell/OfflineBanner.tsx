"use client";

import { WifiSlashIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Shown on every page while the browser is offline; it goes away by itself when the connection is back. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" data-testid="offline-banner" className="sticky top-0 z-20 flex items-center gap-2 border-b border-pending/50 bg-paper-sunk px-[var(--gutter)] py-2 text-[13px] text-ink">
      <WifiSlashIcon size={16} weight="bold" aria-hidden className="shrink-0 text-pending-ink" />
      <span>
        <span className="font-semibold">Internet nahi hai.</span> Jo dikh raha hai woh pichhli baar ka hai. Connection aate hi Bahi phir se kaam karega.
      </span>
    </div>
  );
}
