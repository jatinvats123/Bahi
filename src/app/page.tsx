import { connection } from "next/server";
import { CommandView } from "@/components/command/CommandView";
import { getPublicConfig } from "@/lib/config";
import { getDemoScripts, getLedger } from "@/lib/data";
import { summarizeHisaab } from "@/lib/ledger";

export default async function CommandPage() {
  await connection();
  const config = getPublicConfig();
  const now = new Date();
  const ledger = await getLedger(now);

  return (
    <CommandView
      businessName={config.businessName}
      scripts={getDemoScripts()}
      demoScriptId="s2-approval"
      hisaab={ledger.source === "unavailable" ? null : summarizeHisaab(ledger.invoices, now)}
      approvalThresholdInr={config.approvalThresholdInr}
      approvalsChannel={config.slackApprovalsChannel}
    />
  );
}
