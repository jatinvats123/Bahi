/**
 * The only place the product name, tagline and wordmark live.
 * Import from here; never hardcode the name elsewhere.
 */
export const brand = {
  APP_NAME: "Bahi",
  /** Devanagari wordmark, set in Tiro Devanagari Hindi. */
  WORDMARK_HI: "बही",
  TAGLINE: "Bol ke business chalao.",
  DESCRIPTION:
    "Voice-first AI operator for Indian small businesses. Invoices, payments, reminders and team updates, all through policy-checked Swytchcode actions.",
  NAME_STORY:
    "Named after the bahi-khata, the red cloth ledger Indian traders have kept for centuries.",
} as const;

export const { APP_NAME, WORDMARK_HI, TAGLINE } = brand;
