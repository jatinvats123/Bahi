/**
 * Runs once when the Next server starts. Networks with broken IPv6 (common on venue and
 * hotel Wi-Fi) made every model call time out while IPv4 worked, so resolve IPv4 first.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");
  }
}
