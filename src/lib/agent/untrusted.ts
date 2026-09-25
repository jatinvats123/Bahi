/**
 * Email is untrusted input. Bodies go to the model trimmed and fenced, and a cheap
 * rule check flags obvious prompt injection before the model even reads it
 * (defence in depth: the prompt rules and the refund guard in tools.ts still apply).
 * Pure module, unit tested.
 */

export const MAX_EMAIL_CHARS = 2_000;

/** Fence untrusted text so the model can tell data from instructions. The fence cannot be closed from inside. */
export function wrapUntrusted(text: string, max = MAX_EMAIL_CHARS): string {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/<\/?\s*untrusted_email[^>]*>/gi, "[tag removed]")
    // Zero-width and bidi control characters are a classic way to hide instructions.
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, "")
    .trim();
  const body = clean.length > max ? `${clean.slice(0, max)}\n[trimmed: ${clean.length - max} more characters]` : clean;
  return `<untrusted_email>\n${body}\n</untrusted_email>`;
}

const SIGNALS: { re: RegExp; reason: string }[] = [
  { re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|your)\b.{0,40}\b(instructions?|rules?|polic(y|ies)|prompts?)\b/i, reason: "asks the assistant to ignore its instructions" },
  { re: /\b(system (override|prompt|instruction)|maintenance mode|developer mode|jailbreak|you are now)\b/i, reason: "pretends to be a system instruction" },
  { re: /\b(refund|reverse|return)\b.{0,40}\b(all|every|each|sab|sabke|saare)\b.{0,30}\b(payments?|transactions?|invoices?|paise|money)\b/i, reason: "asks for a bulk refund" },
  { re: /\b(all|every|sab|sabke|saare)\b.{0,20}\b(payments?|paise)\b.{0,30}\b(refund|wapas|lauta)/i, reason: "asks for a bulk refund" },
  { re: /\b(change|update|new)\b.{0,30}\b(bank|account|ifsc|upi|beneficiary)\b.{0,30}\b(details?|number|id)\b/i, reason: "asks to change bank or payment details" },
  { re: /\b(send|transfer|wire|pay)\b.{0,40}\b(to this account|to my account|to the following account|urgently)\b/i, reason: "asks to move money to an account" },
  { re: /\b(do not|don't|dont)\b.{0,20}\b(tell|inform|notify)\b.{0,20}\b(the )?(owner|anyone|boss)\b/i, reason: "asks to hide the action from the owner" },
  { re: /\b(password|otp|api key|secret|credentials?)\b/i, reason: "asks for secrets or credentials" },
];

/** Plain reasons an email looks like prompt injection or fraud. Empty means nothing obvious. */
export function suspiciousSignals(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`;
  const out = new Set<string>();
  for (const s of SIGNALS) if (s.re.test(text)) out.add(s.reason);
  return [...out];
}

/** True when the owner's own command asks for a refund (money never moves back on an email's say-so). */
export function ownerAskedForRefund(command: string): boolean {
  return /\b(refund|refunds|wapas|waapas|lauta|lautao|lauta do|return (the )?(money|payment)|paise wapas)/i.test(command);
}
