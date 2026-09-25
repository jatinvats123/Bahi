import { LedgerSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="pt-28">
      <LedgerSkeleton rows={5} label="Activity load ho rahi hai" />
    </div>
  );
}
