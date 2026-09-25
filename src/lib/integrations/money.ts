/**
 * Rupees are Bahi's unit everywhere. PayPal sandbox business accounts may refuse
 * INR invoices; then PAYPAL_CURRENCY=USD and we convert at DEMO_INR_PER_USD, and
 * the UI shows "PayPal sandbox: $X" as a small honest note.
 */

export interface CurrencyConfig {
  currency: "INR" | "USD";
  inrPerUsd: number;
}

/** PayPal money object for a rupee amount. PayPal wants a string with 2 decimals. */
export function toPaypalMoney(amountInr: number, cfg: CurrencyConfig): { currency_code: string; value: string } {
  const value = cfg.currency === "INR" ? amountInr : amountInr / cfg.inrPerUsd;
  return { currency_code: cfg.currency, value: value.toFixed(2) };
}

/** Rupees for a PayPal amount in `currency`. Unknown currencies pass through unchanged. */
export function paypalToInr(amount: number, currency: string, cfg: CurrencyConfig): number {
  if (currency === "USD") return Math.round(amount * cfg.inrPerUsd);
  return Math.round(amount);
}

/** "$180.72" for the honest sandbox note. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}
