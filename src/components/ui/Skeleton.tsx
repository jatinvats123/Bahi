/** Skeletons shaped like ledger rows: a margin timestamp, an icon and two lines of ink. */

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton-ink block ${className}`} />;
}

export function LedgerRowSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="margin-grid min-h-16 items-start border-b border-rule/60 py-3.5" aria-hidden>
      <div className="flex justify-end pt-1 pr-2.5">
        <Skeleton className="h-3 w-9" />
      </div>
      <div className="flex gap-3 pr-[var(--gutter)] pl-[var(--gutter)]">
        <Skeleton className="size-5 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className={`h-4 ${wide ? "w-2/3" : "w-2/5"}`} />
          <Skeleton className={`h-3 ${wide ? "w-1/2" : "w-3/5"}`} />
        </div>
      </div>
    </div>
  );
}

export function LedgerSkeleton({ rows = 5, label = "Load ho raha hai" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <LedgerRowSkeleton key={i} wide={i % 2 === 0} />
      ))}
    </div>
  );
}
