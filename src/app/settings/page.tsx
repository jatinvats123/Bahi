import { BrainIcon, ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { IntegrationHealthCard } from "@/components/settings/IntegrationHealth";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeSegment } from "@/components/shell/ThemeSegment";
import { Card, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { getPublicConfig } from "@/lib/config";
import { formatINR } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1 border-b border-rule/70 px-4 py-3 last:border-b-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] font-semibold text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">
        {children}
        {hint ? <p className="mt-0.5 text-[12.5px] text-ink-soft">{hint}</p> : null}
      </dd>
    </div>
  );
}

export default async function SettingsPage() {
  await connection();
  const c = getPublicConfig();

  return (
    <div className="pb-16">
      <PageHeader title="Settings" lead="Setup aur guardrails. Keys sirf .env.local mein rehti hain; yahan kabhi nahi dikhengi." />

      <div className="after-margin grid max-w-[1180px] gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card labelledBy="swytch-title">
            <CardHeader
              id="swytch-title"
              title="Swytchcode"
              hint="Har bahar ka kaam (PayPal, Gmail, Slack, Notion, Jira) Swytchcode se hota hai: policy check, retry, audit."
              action={c.mode === "mock" ? <Chip tone="pending">Mock mode</Chip> : <Chip tone="paid">Live sandbox</Chip>}
            />
            <dl>
              <Row label="Mode" hint={c.mode === "mock" ? "Fixtures se data. Koi account nahi chahiye, koi asli call nahi." : "Sandbox accounts par asli calls."}>
                <span className="num">SWYTCH_MODE={c.mode}</span>
              </Row>
              <Row label="Execution" hint="Har call Swytchcode kernel se: input check, policy, credentials, retry, audit. Keys kabhi app mein nahi aati.">
                <span className="num">swytchcode exec ({c.swytch.transport})</span>
              </Row>
              <Row label="PayPal currency" hint={c.swytch.paypalCurrency === "USD" ? "Sandbox INR invoice nahi leta, isliye PayPal mein USD. Bahi mein rupaye hi dikhte hain." : undefined}>
                <span className="num">
                  {c.swytch.paypalCurrency}
                  {c.swytch.paypalCurrency === "USD" ? `, 1 USD = ${c.swytch.inrPerUsd} INR (demo rate)` : ""}
                </span>
              </Row>
            </dl>
          </Card>

          <IntegrationHealthCard mode={c.mode} />
        </div>

        <div className="space-y-6">
          <Card labelledBy="look-title">
            <CardHeader id="look-title" title="Dikhawat" hint="Light, dark, ya system ke hisaab se." />
            <div className="px-4 py-4">
              <ThemeSegment />
            </div>
          </Card>

          <Card labelledBy="guard-title">
            <CardHeader
              id="guard-title"
              title="Guardrails"
              hint="Paisa bina check ke nahi hilta."
              action={<ShieldCheckIcon size={20} weight="duotone" className="text-paid-ink" aria-hidden />}
            />
            <dl>
              <Row label="Approval limit" hint="Is se bade invoice Slack mein approval maangte hain.">
                <span className="num font-semibold">{formatINR(c.approvalThresholdInr)}</span>
              </Row>
              <Row label="Refund block" hint="Bulk refund aur is se bada refund hamesha blocked.">
                <span className="num font-semibold">{formatINR(c.refundBlockThresholdInr)}</span>
              </Row>
              <Row label="Duplicate hukum" hint="Idempotency keys, phase 4.">
                Ek hi kaam do baar nahi hoga
              </Row>
            </dl>
          </Card>

          <Card labelledBy="brain-title">
            <CardHeader
              id="brain-title"
              title="Agent brain"
              hint="Vercel AI SDK. Gemini pehle, Groq fallback."
              action={<BrainIcon size={20} weight="duotone" className="text-ink-soft" aria-hidden />}
            />
            <dl>
              <Row label="Gemini" hint="Models kram se aazmaaye jaate hain. Free tier: 20 requests har din har model.">
                {c.models.gemini.configured ? <Chip tone="paid">Key set</Chip> : <Chip>Key nahi</Chip>}
                {c.models.gemini.backupKey ? <Chip tone="paid" className="ml-1.5">Backup key</Chip> : <Chip className="ml-1.5">Backup key nahi</Chip>}
                <span className="num mt-1 block text-[12.5px] break-words text-ink-soft">{c.models.gemini.model.split(",").join(" > ")}</span>
              </Row>
              <Row label="Groq (fallback)">
                {c.models.groq.configured ? <Chip tone="paid">Key set</Chip> : <Chip>Key nahi</Chip>}
                <span className="num mt-1 block text-[12.5px] break-words text-ink-soft">{c.models.groq.model.split(",").join(" > ")}</span>
              </Row>
              <Row label="Laya (System 1)" hint="Optional, phase 6. Intent routing, email triage, injection guard.">
                {c.laya.enabled ? <Chip tone="paid">On</Chip> : <Chip>Off</Chip>}
                <span className="num ml-2 text-[12.5px] text-ink-soft">{c.laya.url}</span>
              </Row>
            </dl>
          </Card>

          <Card labelledBy="biz-title">
            <CardHeader id="biz-title" title="Business" />
            <dl>
              <Row label="Naam">{c.businessName}</Row>
              <Row label="Email">{c.businessEmail ?? <span className="text-ink-soft">Set nahi (BUSINESS_EMAIL)</span>}</Row>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
