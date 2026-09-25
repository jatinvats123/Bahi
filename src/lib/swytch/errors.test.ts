import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyCliFailure, kindFromExitCode, normalizeSdkError, ownerMessage, parseClassifiedError, unwrapKernelOutput, type ExecErrorKind } from "./errors";

interface CliSample {
  exitCode: number;
  stdout: string;
  stderr: string;
}
const dir = path.join(process.cwd(), "fixtures", "recorded", "cli");
const sample = (name: string) => JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8")) as CliSample;

describe("CLI exit codes", () => {
  it("maps the documented codes 0-5 plus the observed 6 and 7", () => {
    const expected: [number | null, ExecErrorKind][] = [
      [0, "unknown"], // 0 is success; never classified as a failure kind
      [1, "provider"],
      [2, "validation"],
      [3, "auth"],
      [4, "policy_blocked"],
      [5, "not_found"],
      [6, "policy_blocked"],
      [7, "approval_required"],
      [null, "unknown"],
      [99, "unknown"],
    ];
    for (const [code, kind] of expected) expect(kindFromExitCode(code), `exit ${code}`).toBe(kind);
  });

  it("falls back to the exit code when stderr has nothing structured", () => {
    for (const [code, kind] of [
      [2, "validation"],
      [3, "auth"],
      [4, "policy_blocked"],
      [5, "not_found"],
      [1, "provider"],
    ] as const) {
      expect(classifyCliFailure({ exitCode: code, stdout: "", stderr: "something went wrong" }).kind).toBe(kind);
    }
  });
});

describe("real swytchcode 2.23.5 failures (fixtures/recorded/cli)", () => {
  it("has a fixture for every case", () => {
    expect(readdirSync(dir).sort()).toEqual(
      ["approval-pending.json", "audit-policy.json", "auth-missing.json", "dry-run.json", "exec-http-200.json", "exec-http-400.json", "network.json", "not-found.json", "policy-blocked.json"].sort(),
    );
  });

  it("unknown tool: exits 2 but the category says not_found", () => {
    const e = classifyCliFailure(sample("not-found"));
    expect(e).toMatchObject({ kind: "not_found", exitCode: 2, category: "not_found" });
    expect(e.message).toMatch(/not configured in this project's tooling.json/);
  });

  it("missing provider credentials: auth", () => {
    expect(classifyCliFailure(sample("auth-missing"))).toMatchObject({ kind: "auth", exitCode: 3 });
  });

  it("network failure: exits 4 (documented as policy) but is network, retryable", () => {
    const e = classifyCliFailure(sample("network"));
    expect(e.kind).toBe("timeout"); // "context deadline exceeded"
    expect(e.retryable).toBe(true);
    expect(e.exitCode).toBe(4);
  });

  it("policy block: exit 6, category policy_denied, policy id extracted", () => {
    expect(classifyCliFailure(sample("policy-blocked"))).toMatchObject({ kind: "policy_blocked", policyId: "big-block", exitCode: 6 });
  });

  it("approval hold: exit 7, plain text, policy and request ids extracted", () => {
    expect(classifyCliFailure(sample("approval-pending"))).toMatchObject({
      kind: "approval_required",
      policyId: "mid-approve",
      approvalRequestId: "64435d426d9f",
      exitCode: 7,
    });
  });

  it("finds the classified JSON among log lines (SDK's JSON.parse(stderr) would miss it)", () => {
    const s = sample("auth-missing").stderr;
    expect(() => JSON.parse(s) as unknown).toThrow();
    expect(parseClassifiedError(s)?.category).toBe("auth");
  });
});

describe("other failure shapes", () => {
  it("our own timeout and spawn failures", () => {
    expect(classifyCliFailure({ exitCode: null, stdout: "", stderr: "", timedOut: true, timeoutMs: 45000 })).toMatchObject({ kind: "timeout", retryable: true });
    expect(classifyCliFailure({ exitCode: null, stdout: "", stderr: "", spawnErrorCode: "ENOENT" }).message).toMatch(/npm install -g swytchcode/);
  });

  it("approval denied and expired", () => {
    expect(classifyCliFailure({ exitCode: 1, stdout: "", stderr: "approval was denied by jatin" }).kind).toBe("approval_denied");
    expect(classifyCliFailure({ exitCode: 1, stdout: "", stderr: "approval request expired" }).kind).toBe("approval_denied");
  });

  it("provider errors keep the upstream HTTP status", () => {
    const e = classifyCliFailure({ exitCode: 1, stdout: "", stderr: '{"error":"upstream returned status 422: CURRENCY_NOT_SUPPORTED","category":"provider"}' });
    expect(e).toMatchObject({ kind: "provider", httpStatus: 422 });
  });

  it("raw network errors without JSON", () => {
    expect(classifyCliFailure({ exitCode: 1, stdout: "", stderr: "dial tcp: lookup api.notion.com: no such host" }).kind).toBe("network");
  });
});

describe("@swytchcode/runtime SwytchcodeError normalization", () => {
  const sdkError = (message: string, cause?: unknown, details?: object) => Object.assign(new Error(message), { name: "SwytchcodeError", cause, details });

  it("uses the exit code in cause and the whole stderr in message", () => {
    expect(normalizeSdkError(sdkError(sample("approval-pending").stderr, 7))).toMatchObject({ kind: "approval_required", policyId: "mid-approve" });
    expect(normalizeSdkError(sdkError(sample("policy-blocked").stderr, 6))).toMatchObject({ kind: "policy_blocked", policyId: "big-block" });
    expect(normalizeSdkError(sdkError(sample("auth-missing").stderr, 3)).kind).toBe("auth");
  });

  it("uses details.category when stderr was pure JSON", () => {
    expect(normalizeSdkError(sdkError("missing credentials for Slack", 3, { category: "auth" })).kind).toBe("auth");
    expect(normalizeSdkError(sdkError("tool not configured", 2, { category: "not_found" })).kind).toBe("not_found");
  });

  it("spawn failures, timeouts and non-errors", () => {
    expect(normalizeSdkError(sdkError("Failed to spawn swytchcode", { code: "ENOENT" })).message).toMatch(/not found/);
    expect(normalizeSdkError(sdkError("swytchcode exec timed out after 1000ms")).kind).toBe("timeout");
    expect(normalizeSdkError("boom").kind).toBe("unknown");
  });
});

describe("kernel output and owner messages", () => {
  it("unwraps the {success, result} envelope and passes bare output through", () => {
    expect(unwrapKernelOutput({ success: true, result: { id: 1 } })).toEqual({ ok: true, data: { id: 1 } });
    expect(unwrapKernelOutput({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
    expect(unwrapKernelOutput(null)).toEqual({ ok: true, data: null });
    expect(unwrapKernelOutput({ success: false, error: "nope" })).toMatchObject({ ok: false, error: { kind: "provider", message: "nope" } });
  });

  it("unwraps the real exec envelope: data on 2xx, an error on HTTP 4xx even though the CLI exits 0", () => {
    const ok = sample("exec-http-200");
    expect(ok.exitCode).toBe(0);
    expect(unwrapKernelOutput(JSON.parse(ok.stdout))).toEqual({ ok: true, data: {} });

    const bad = sample("exec-http-400");
    expect(bad.exitCode).toBe(0);
    const r = unwrapKernelOutput(JSON.parse(bad.stdout));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ kind: "validation", httpStatus: 400, retryable: false });
      expect(r.error.message).toMatch(/HTTP 400: .*Currency Code is not valid/);
    }
  });

  it("maps HTTP statuses when there is no category", () => {
    const env = (status: number, body: unknown) => ({ data: body, request: { method: "GET", url: "https://x" }, status_code: status });
    expect(unwrapKernelOutput(env(401, { error: "invalid_token", error_description: "Token expired" }))).toMatchObject({ ok: false, error: { kind: "auth", message: "HTTP 401: invalid_token: Token expired" } });
    expect(unwrapKernelOutput(env(404, { message: "not found" }))).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(unwrapKernelOutput(env(503, null))).toMatchObject({ ok: false, error: { kind: "provider", retryable: true, message: "HTTP 503" } });
    expect(unwrapKernelOutput(env(201, { id: "INV2-1" }))).toEqual({ ok: true, data: { id: "INV2-1" } });
  });

  it("owner messages are short, plain and never leak the raw error", () => {
    const msg = ownerMessage({ kind: "auth", message: "token xoxb-secret expired" }, "Slack");
    expect(msg).toMatch(/Slack/);
    expect(msg).not.toMatch(/xoxb/);
    expect(ownerMessage({ kind: "policy_blocked", message: "x" }, "PayPal")).toBe("Rok diya gaya: policy.");
  });
});

describe("phase 4: approvals on a plan without them", () => {
  it("REQUIRES_APPROVAL refused by the plan is a block with a plain reason, not a hold (observed 26 Sep 2026)", () => {
    const stderr = [
      "2026/09/26 00:11:02 [swytchcode exec] request tool=stripe.create_payment {}",
      "approval test",
      "This command needs approval, but the request could not be created: approval requests are not included in your current plan - upgrade at https://app.swytchcode.com/dashboard/payments/plans. The command was not run.",
      "2026/09/26 00:11:02 [swytchcode exec] failed tool=stripe.create_payment exit_code=6 error=approval request refused: approval requests are not included in your current plan",
    ].join("\n");
    const e = classifyCliFailure({ exitCode: 6, stdout: "", stderr });
    expect(e.kind).toBe("policy_blocked");
    expect(e.category).toBe("approval_unavailable");
    expect(e.message).toMatch(/APPROVAL_MODE=gate/);
  });

  it("a real HITL hold says Swytchcode holds it", () => {
    const e = classifyCliFailure({ exitCode: 7, stdout: "", stderr: 'Approval requested for invoices.invoicing.invoices.create (policy "invoice-approval-over-threshold"). Request abc123.' });
    expect(e).toMatchObject({ kind: "approval_required", approvalVia: "swytchcode", approvalRequestId: "abc123" });
  });
});

describe("swy exec --explain output", () => {
  it("parses the explain block (printed on stderr in 2.23.5)", async () => {
    const { parseExplainOutput } = await import("./runtime");
    const text = [
      "2026/09/26 00:23:36 [swytchcode exec] request tool=invoices.invoicing.send.create {}",
      "Tool:        invoices.invoicing.send.create",
      "Provider: PayPal.invoicing_v2@2.0",
      "Mode:        production",
      "Endpoint:    POST https://api-m.sandbox.paypal.com/v2/invoicing/invoices/{invoice_id}/send",
      "no real API call was made.",
    ].join("\n");
    expect(parseExplainOutput(text)).toEqual({
      tool: "invoices.invoicing.send.create",
      provider: "PayPal.invoicing_v2@2.0",
      mode: "production",
      endpoint: "POST https://api-m.sandbox.paypal.com/v2/invoicing/invoices/{invoice_id}/send",
    });
  });
});
