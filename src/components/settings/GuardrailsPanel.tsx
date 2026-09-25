import { ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import { Card, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import type { GuardrailStatus } from "@/lib/guardrails/status";

/** Settings: the active Swytchcode policies in plain language, plus duplicate protection. */
export function GuardrailsPanel({ status }: { status: GuardrailStatus }) {
  const paypalIdem = status.idempotency.filter((i) => i.library.startsWith("PayPal."));
  return (
    <Card labelledBy="guard-title">
      <CardHeader
        id="guard-title"
        title="Guardrails"
        hint="Swytchcode policies har call se pehle chalti hain, network se pehle. Paisa bina check ke nahi hilta."
        action={<ShieldCheckIcon size={20} weight="duotone" className="text-paid-ink" aria-hidden />}
      />
      {status.fileMissing ? (
        <p className="border-b border-rule/70 px-4 py-3 text-[13px] text-blocked-ink">
          policies.json nahi mila. Chalao: <span className="num">npm run policies:sync</span>
        </p>
      ) : !status.inSync ? (
        <p className="border-b border-rule/70 px-4 py-3 text-[13px] text-pending-ink">
          policies.json purana hai (threshold ya client list badli). Chalao: <span className="num">npm run policies:sync</span>
        </p>
      ) : null}
      <ul>
        {status.policies.map((p) => (
          <li key={p.id} className="border-b border-rule/70 px-4 py-3.5 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <p className="font-serif text-[16px] leading-snug text-ink">{p.title}</p>
              {p.active ? <Chip tone={p.outcome === "approval" ? "approval" : "blocked"}>{p.outcome === "approval" ? "Approval" : "Block"}</Chip> : <Chip tone="pending">Active nahi</Chip>}
            </div>
            <p className="mt-1 text-[13.5px] text-ink">{p.rule}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">{p.why}</p>
            <p className="num mt-1.5 text-[11.5px] break-all text-ink-faint-text">
              {p.id} on {p.target}
            </p>
          </li>
        ))}
        <li className="border-b border-rule/70 px-4 py-3.5">
          <p className="font-serif text-[16px] leading-snug text-ink">Approval kaise hota hai</p>
          <p className="mt-1 text-[13.5px] text-ink">
            {status.approvalMode === "gate"
              ? `Swytchcode bada invoice rok leta hai. Owner Bahi dashboard (ya Slack link) se approve kare to hi PayPal tak jaata hai. ${Math.round(status.approvalTimeoutSec / 60)} minute mein faisla na ho to expire.`
              : "Swytchcode Slack mein Approve / Deny maangta hai (Swytchcode plan mein approvals chahiye)."}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            Mode: <span className="num">APPROVAL_MODE={status.approvalMode}</span>
          </p>
        </li>
        <li className="px-4 py-3.5">
          <p className="font-serif text-[16px] leading-snug text-ink">Duplicate se bachav</p>
          <p className="mt-1 text-[13.5px] text-ink">Swytchcode retry ko safe banata hai; Bahi ki intent key dohraye gaye hukum ko.</p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">Ek hi client, amount, kaam aur din ka invoice dobara nahi banega. Reminder: ek invoice par din mein ek.</p>
          <ul className="mt-2 space-y-1">
            {paypalIdem.map((i) => (
              <li key={i.library} className="num text-[11.5px] break-all text-ink-soft">
                <span className={i.mode === "dynamic" ? "font-semibold text-paid-ink" : ""}>{i.mode}</span> idempotency, {i.library.replace(/^PayPal\./, "PayPal ")}
                {i.header ? `, header ${i.header}` : ""}
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </Card>
  );
}
