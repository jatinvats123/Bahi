/**
 * Money and time formatting. Every amount and timestamp in the UI goes through here.
 * Money: Indian digit grouping (₹1,50,000). Time: always IST, e.g. "26 Sep, 2:14 PM".
 */

const IST = "Asia/Kolkata";

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const groupedIN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹1,50,000. Shows paise only when the amount has them. */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return "₹0";
  return Number.isInteger(amount) ? inrWhole.format(amount) : inrPaise.format(amount);
}

/** 1,50,000 (Indian grouping, no currency sign). */
export function formatNumberIN(value: number): string {
  return groupedIN.format(Number.isFinite(value) ? value : 0);
}

type DateInput = Date | string | number;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

// en-US parts give "Sep" and "PM"; en-IN would give "Sept" and "pm".
const istParts = new Intl.DateTimeFormat("en-US", {
  timeZone: IST,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

interface IstParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  dayPeriod: string;
}

function partsIST(input: DateInput): IstParts {
  const out: IstParts = { year: "", month: "", day: "", hour: "", minute: "", second: "", dayPeriod: "" };
  for (const p of istParts.formatToParts(toDate(input))) {
    if (p.type in out) out[p.type as keyof IstParts] = p.value;
  }
  out.dayPeriod = out.dayPeriod.toUpperCase();
  return out;
}

/** "26 Sep, 2:14 PM" */
export function formatIST(input: DateInput): string {
  const p = partsIST(input);
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "2:14 PM", or "2:14:07 PM" with seconds. */
export function formatTimeIST(input: DateInput, opts: { seconds?: boolean } = {}): string {
  const p = partsIST(input);
  const secs = opts.seconds ? `:${p.second}` : "";
  return `${p.hour}:${p.minute}${secs} ${p.dayPeriod}`;
}

/** "26 Sep", or "26 Sep 2026" with year. */
export function formatDateIST(input: DateInput, opts: { year?: boolean } = {}): string {
  const p = partsIST(input);
  return opts.year ? `${p.day} ${p.month} ${p.year}` : `${p.day} ${p.month}`;
}

const istKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in IST as "2026-09-26". Use for grouping and "today" checks. */
export function istDateKey(input: DateInput): string {
  return istKey.format(toDate(input));
}

/** "Aaj", "Kal" or "24 Sep" relative to `now`, in IST calendar days. */
export function dayLabelIST(input: DateInput, now: DateInput = new Date()): string {
  const key = istDateKey(input);
  if (key === istDateKey(now)) return "Aaj";
  const yesterday = new Date(toDate(now).getTime() - 86_400_000);
  if (key === istDateKey(yesterday)) return "Kal";
  return formatDateIST(input);
}

/** "412 ms" below a second, "1.2 s" above. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
