import { connection } from "next/server";
import { CommandView } from "@/components/command/CommandView";
import { getClientDirectory } from "@/lib/clients";
import { getPublicConfig } from "@/lib/config";

export default async function CommandPage() {
  await connection();
  const config = getPublicConfig();
  // Names and aliases only: the browser resolves spoken client names for the confirm strip, never sees emails.
  const clients = getClientDirectory().map(({ id, name, aliases, contact }) => ({ id, name, aliases, contact }));

  return (
    <CommandView
      businessName={config.businessName}
      approvalThresholdInr={config.approvalThresholdInr}
      approvalsChannel={config.slackApprovalsChannel}
      clients={clients}
    />
  );
}
