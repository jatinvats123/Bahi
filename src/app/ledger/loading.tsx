import { LedgerSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="pt-24">
      <LedgerSkeleton rows={6} label="Ledger load ho raha hai" />
    </div>
  );
}
