import { connection } from "next/server";
import { CommandView } from "@/components/command/CommandView";
import { getPublicConfig } from "@/lib/config";

export default async function CommandPage() {
  await connection();
  const config = getPublicConfig();

  return (
    <CommandView businessName={config.businessName} approvalThresholdInr={config.approvalThresholdInr} approvalsChannel={config.slackApprovalsChannel} />
  );
}
