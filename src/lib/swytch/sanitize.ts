/**
 * Scrubs real provider responses before they are saved to fixtures/recorded/.
 * Removes emails, tokens and identifiers while keeping the JSON shape, so parser
 * tests exercise the real structure. Ids become stable placeholders (same input id,
 * same placeholder) so cross-references inside one response stay consistent.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /\b(xox[abposr]-[A-Za-z0-9-]+|xapp-[A-Za-z0-9-]+|ya29\.[A-Za-z0-9._-]+|secret_[A-Za-z0-9]+|ntn_[A-Za-z0-9]+|swy_key_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._-]+|EC-[A-Z0-9]{17}|A21AA[A-Za-z0-9_-]{20,})\b/g;
const UUID_RE = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const PAYPAL_INV_RE = /\bINV2(-[A-Z0-9]{4}){4}\b/g;

/** Keys whose values are opaque identifiers. */
const ID_KEYS = /^(id|threadId|historyId|ts|channel|team|team_id|user|user_id|bot_id|app_id|enterprise_id|accountId|self|key|payment_id|transaction_id|invoice_number|reference|cursor|next_cursor|nextPageToken|request_id|capture_id|database_id|data_source_id|page_id|block_id|workspace_id|internalDate)$/;
/** Keys dropped entirely (tokens, secrets, avatars). */
const DROP_KEYS = /^(access_token|refresh_token|token|authorization|Authorization|client_secret|password|image_\d+|avatar_url|icon)$/;

export interface SanitizeOptions {
  /** Keep these exact strings (e.g. our own demo business name). */
  keep?: readonly string[];
}

export function createSanitizer(opts: SanitizeOptions = {}) {
  const ids = new Map<string, string>();
  const keep = new Set(opts.keep ?? []);

  const placeholder = (value: string, kind: string) => {
    let p = ids.get(value);
    if (!p) {
      p = `${kind}_${String(ids.size + 1).padStart(3, "0")}`;
      ids.set(value, p);
    }
    return p;
  };

  const scrubText = (s: string): string => {
    if (keep.has(s)) return s;
    return s
      .replace(TOKEN_RE, "REDACTED_TOKEN")
      .replace(EMAIL_RE, (m) => `${placeholder(m.toLowerCase(), "user")}@example.com`)
      .replace(PAYPAL_INV_RE, (m) => placeholder(m, "INV2"))
      .replace(UUID_RE, (m) => placeholder(m.replace(/-/g, "").toLowerCase(), "uuid"));
  };

  /** Gmail body data is base64url text: decode, scrub, re-encode. */
  const scrubBase64 = (s: string): string => {
    try {
      const text = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/[\x00-\x08\x0e-\x1f]/.test(text)) return "REDACTED_BINARY";
      return Buffer.from(scrubText(text), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch {
      return "REDACTED_BINARY";
    }
  };

  const walk = (v: unknown, key: string | null, parentKey: string | null): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key, parentKey));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (DROP_KEYS.test(k)) continue;
        out[k] = walk(val, k, key);
      }
      return out;
    }
    if (typeof v !== "string") return v;
    if (key === "data" && parentKey === "body") return scrubBase64(v);
    if (key === "raw") return scrubBase64(v);
    if (key && ID_KEYS.test(key) && v.length > 0 && !keep.has(v)) {
      // Keep Jira-style keys readable ("BAHI-12") but anonymous.
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(v)) return v.replace(/-\d+$/, `-${placeholder(v, "n").slice(2)}`);
      return placeholder(v, key.replace(/[^a-z]/gi, "").toLowerCase() || "id");
    }
    return scrubText(v);
  };

  return (value: unknown) => walk(value, null, null);
}

export function sanitize(value: unknown, opts?: SanitizeOptions): unknown {
  return createSanitizer(opts)(value);
}
