import { LedgerSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="pt-24">
      <LedgerSkeleton rows={5} label="Settings load ho rahi hain" />
    </div>
  );
}
