import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RunReplay } from "@/components/activity/RunReplay";
import { PageHeader } from "@/components/shell/PageHeader";
import { getRun } from "@/lib/data";
import { formatDateIST, formatTimeIST } from "@/lib/format";

export const metadata: Metadata = { title: "Run replay" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  return (
    <div className="pb-16">
      <PageHeader
        title="Run replay"
        lead="Yeh run dobara chal raha hai, usi kram mein jaise hua tha. Koi naya kaam nahi hota; sirf record dikhaya jaata hai."
        margin={
          <span className="num text-right text-[11px] leading-[1.35] text-ink-faint-text">
            {formatDateIST(run.startedAt)}
            <br />
            {formatTimeIST(run.startedAt)}
          </span>
        }
        actions={
          <Link
            href="/activity"
            className="inline-flex items-center gap-1.5 rounded text-[13px] font-semibold text-bahi-ink underline-offset-4 hover:underline"
          >
            <ArrowLeftIcon size={14} weight="bold" aria-hidden />
            Sab runs
          </Link>
        }
      />
      <div className="max-w-[calc(860px+var(--margin-x)+2*var(--gutter))]">
        <RunReplay events={run.events} />
      </div>
    </div>
  );
}
