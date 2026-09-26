import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { classifyCliFailure, normalizeSdkError, type ExecError } from "./errors";

/**
 * How a tool call reaches Swytchcode. Both paths run the same Swytchcode kernel
 * (validation, policies, credentials, retries, idempotency, audit):
 *
 * - "cli" (default): async spawn of the native swytchcode binary with the input as
 *   JSON on stdin (`swytchcode exec <id> --json`). Non-blocking, gives us the exit
 *   code, stdout and stderr, which is how approval holds are detected (they print
 *   plain text and exit 7; no JSON). The binary is spawned directly, never through
 *   cmd.exe, so there is no shell and no quoting to get wrong on Windows.
 * - "sdk": @swytchcode/runtime's exec(). It uses spawnSync, which would freeze the
 *   Next.js server (and every open NDJSON stream) for the whole API call, so it runs
 *   inside a worker thread. Its errors are normalized with normalizeSdkError().
 */

export type TransportName = "cli" | "sdk";

export interface TransportRequest {
  tool: string;
  input: unknown;
  cwd: string;
  timeoutMs: number;
  dryRun: boolean;
  bin: string | null;
}

export type TransportResponse =
  | { ok: true; data: unknown; stderr: string }
  | { ok: false; error: ExecError; stderr: string };

const WIN_ARCH = process.arch === "arm64" ? "arm64" : "x64";

/**
 * Find the native swytchcode binary. Order: SWYTCHCODE_BIN, the platform package
 * inside a global npm install, a local node_modules copy, the curl/irm install path,
 * then plain "swytchcode" on PATH (fine on macOS/Linux; on Windows the npm entry is a
 * .cmd shim that needs a shell, so we avoid it there).
 */
/**
 * Environment for the CLI. Telemetry is off unless SWYTCHCODE_NO_TELEMETRY=0: its PostHog
 * upload cost about 1.4 s per call, and up to 30 s when PostHog was unreachable (26 Sep 2026).
 */
export function cliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const v = env.SWYTCHCODE_NO_TELEMETRY?.trim();
  return { ...env, SWYTCHCODE_NO_TELEMETRY: v === "0" ? "" : v || "1" };
}

export function resolveSwytchcodeBinary(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string | null {
  const explicit = env.SWYTCHCODE_BIN?.trim();
  if (explicit) return explicit;

  const candidates: string[] = [];
  if (process.platform === "win32") {
    const pkg = `swytchcode-cli-win32-${WIN_ARCH}`;
    if (env.APPDATA) {
      candidates.push(path.join(env.APPDATA, "npm", "node_modules", "swytchcode", "node_modules", pkg, "bin", "swytchcode.exe"));
      candidates.push(path.join(env.APPDATA, "npm", "node_modules", pkg, "bin", "swytchcode.exe"));
    }
    candidates.push(path.join(cwd, "node_modules", "swytchcode", "node_modules", pkg, "bin", "swytchcode.exe"));
    candidates.push(path.join(cwd, "node_modules", pkg, "bin", "swytchcode.exe"));
    if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "Programs", "swytchcode", "bin", "swytchcode.exe"));
  } else {
    const pkg = `swytchcode-cli-${process.platform}-${process.arch}`;
    candidates.push(path.join(cwd, "node_modules", pkg, "bin", "swytchcode"));
    if (env.HOME) candidates.push(path.join(env.HOME, ".local", "bin", "swytchcode"));
    candidates.push("/usr/local/bin/swytchcode");
  }
  for (const c of candidates) if (existsSync(c)) return c;
  return process.platform === "win32" ? null : "swytchcode";
}

function cliArgs(tool: string, dryRun: boolean): string[] {
  const args = ["exec", tool, "--json"];
  if (dryRun) args.push("--dry-run");
  return args;
}

export function runCli(req: TransportRequest): Promise<TransportResponse> {
  if (!req.bin) {
    return Promise.resolve({
      ok: false,
      stderr: "",
      error: classifyCliFailure({ exitCode: null, stdout: "", stderr: "", spawnErrorCode: "ENOENT" }),
    });
  }
  const bin = req.bin;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (r: TransportResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const child = spawn(bin, cliArgs(req.tool, req.dryRun), {
      cwd: req.cwd,
      env: cliEnv(),
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, req.timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      done({ ok: false, stderr, error: classifyCliFailure({ exitCode: null, stdout, stderr, spawnErrorCode: e.code ?? "UNKNOWN" }) });
    });
    child.on("close", (code) => {
      if (timedOut || code !== 0) {
        done({ ok: false, stderr, error: classifyCliFailure({ exitCode: code, stdout, stderr, timedOut, timeoutMs: req.timeoutMs }) });
        return;
      }
      const out = stdout.trim();
      if (!out) return done({ ok: true, data: null, stderr });
      try {
        done({ ok: true, data: JSON.parse(out) as unknown, stderr });
      } catch {
        done({ ok: false, stderr, error: { kind: "provider", message: "Swytchcode returned output that is not JSON", exitCode: 0 } });
      }
    });
    child.stdin.on("error", () => {
      // The CLI can exit before reading stdin (e.g. unknown tool); the close handler reports it.
    });
    child.stdin.end(JSON.stringify(req.input ?? {}));
  });
}

/**
 * Run any other swytchcode subcommand (audit, policy, exec --explain) and collect its text
 * output. Async spawn, no shell, stdin closed after `stdin`. Never throws.
 */
export function runCliText(opts: { bin: string | null; args: string[]; cwd: string; timeoutMs?: number; stdin?: string }): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  if (!opts.bin) return Promise.resolve({ code: null, stdout: "", stderr: "", error: "Swytchcode CLI not found" });
  const bin = opts.bin;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(bin, opts.args, { cwd: opts.cwd, env: cliEnv(), windowsHide: true, shell: false });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 20_000);
    const done = (r: { code: number | null; stdout: string; stderr: string; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => done({ code: null, stdout, stderr, error: e.message }));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? "");
  });
}

/**
 * Runs @swytchcode/runtime inside a worker so its spawnSync cannot block the server.
 * The worker source is inline (eval) so the bundler never has to trace a worker file;
 * it require()s the package from node_modules at run time.
 */
const SDK_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const req = createRequire(workerData.resolveFrom);
const { exec } = req("@swytchcode/runtime");
exec(workerData.tool, workerData.input, workerData.options).then(
  (data) => parentPort.postMessage({ ok: true, data }),
  (e) => {
    const c = e && e.cause;
    parentPort.postMessage({
      ok: false,
      message: String((e && e.message) || e),
      cause: typeof c === "number" ? c : c && typeof c === "object" && typeof c.code === "string" ? { code: c.code } : null,
      details: (e && e.details) || null,
    });
  },
);
`;

interface SdkWorkerMessage {
  ok: boolean;
  data?: unknown;
  message?: string;
  cause?: number | { code: string } | null;
  details?: { category?: string; retryable?: boolean } | null;
}

export function runSdk(req: TransportRequest): Promise<TransportResponse> {
  return new Promise((resolve) => {
    const env: Record<string, string> = {};
    if (req.bin) env.SWYTCHCODE_BIN = req.bin; // skip the .cmd shim + node launcher hop
    env.SWYTCHCODE_NO_TELEMETRY = cliEnv().SWYTCHCODE_NO_TELEMETRY ?? "1";
    const worker = new Worker(SDK_WORKER_SOURCE, {
      eval: true,
      workerData: {
        tool: req.tool,
        input: req.input ?? {},
        resolveFrom: path.join(req.cwd, "package.json"),
        options: { cwd: req.cwd, env, dryRun: req.dryRun, timeoutMs: req.timeoutMs },
      },
    });
    let settled = false;
    const finish = (r: TransportResponse) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve(r);
    };
    worker.once("message", (m: SdkWorkerMessage) => {
      if (m.ok) return finish({ ok: true, data: m.data ?? null, stderr: "" });
      const err = Object.assign(new Error(m.message ?? "Swytchcode SDK call failed"), { cause: m.cause ?? undefined, details: m.details ?? undefined });
      finish({ ok: false, stderr: "", error: normalizeSdkError(err) });
    });
    worker.once("error", (e) => finish({ ok: false, stderr: "", error: { kind: "unknown", message: `Swytchcode SDK worker failed: ${e.message}` } }));
    worker.once("exit", (code) => {
      if (code !== 0) finish({ ok: false, stderr: "", error: { kind: "unknown", message: `Swytchcode SDK worker exited with code ${code}` } });
    });
  });
}
