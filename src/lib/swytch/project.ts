import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Reads the local Swytchcode project (.swytchcode/): tooling mode, the integration
 * manifest (endpoints, execution policy) and guard policies. Pure helpers are
 * exported separately so tests can exercise them without touching disk.
 */

export const PAYPAL_SANDBOX_HOST = "api-m.sandbox.paypal.com";

const ManifestEntrySchema = z
  .object({
    version: z.string().optional(),
    sandbox_endpoint: z.string().optional(),
    production_endpoint: z.string().optional(),
    execution_policy: z
      .object({
        max_retries: z.number().optional(),
        idempotency: z.object({ mode: z.string().optional(), header_name: z.string().optional() }).loose().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export const ManifestSchema = z.record(z.string(), ManifestEntrySchema);
export type Manifest = z.infer<typeof ManifestSchema>;

const ToolingSchema = z
  .object({
    mode: z.enum(["sandbox", "production"]).optional(),
    tools: z.record(z.string(), z.unknown()).optional(),
    integrations: z.record(z.string(), z.object({ version: z.string() }).loose()).optional(),
    workspace: z.unknown().optional(),
  })
  .loose();

const PolicySchema = z
  .object({
    id: z.string(),
    target: z.array(z.string()),
    action: z.object({ type: z.string(), message: z.string().optional() }).loose(),
  })
  .loose();
export const PoliciesFileSchema = z.object({ policies: z.array(PolicySchema).default([]) }).loose();
export type GuardPolicy = z.infer<typeof PolicySchema>;

export interface SwytchProject {
  dir: string;
  mode: "sandbox" | "production";
  enabledTools: Set<string>;
  /** "PayPal.invoicing_v2@2.0" style keys of the integrations declared in tooling.json. */
  integrations: Set<string>;
  manifest: Manifest;
  policies: GuardPolicy[];
}

/** The endpoint the kernel will call for this manifest entry in this mode. */
export function activeEndpoint(entry: Manifest[string], mode: SwytchProject["mode"]): string | undefined {
  return mode === "production" ? entry.production_endpoint : entry.sandbox_endpoint;
}

/**
 * Bahi's own hard rule: PayPal must only ever reach the sandbox. Returns a problem
 * string when any installed PayPal library would call something else, else null.
 */
export function paypalEndpointProblem(manifest: Manifest, mode: SwytchProject["mode"], integrations?: ReadonlySet<string>): string | null {
  const entries = Object.entries(manifest).filter(([k]) => k.startsWith("PayPal.") && (!integrations || integrations.has(k)));
  if (entries.length === 0) return "PayPal integration is not installed (run: swy get paypal)";
  for (const [key, entry] of entries) {
    const url = activeEndpoint(entry, mode);
    let host = "";
    try {
      host = url ? new URL(url).host : "";
    } catch {
      host = "";
    }
    if (host !== PAYPAL_SANDBOX_HOST) {
      return `${key} would call ${url ?? "(no endpoint)"} in ${mode} mode; Bahi only allows https://${PAYPAL_SANDBOX_HOST}. Run: npm run swytch:configure`;
    }
  }
  return null;
}

export function policiesTargeting(policies: readonly GuardPolicy[], tool: string): GuardPolicy[] {
  return policies.filter((p) => p.target.includes(tool));
}

async function readJson(file: string): Promise<unknown> {
  // The project folder is configured at run time (SWYTCHCODE_PROJECT_DIR); nothing to trace at build time.
  return JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as unknown;
}

let cache: { key: string; project: SwytchProject } | undefined;

/** Load .swytchcode/ from `dir`. Cached until any of the three files changes. */
export async function loadSwytchProject(dir: string): Promise<SwytchProject> {
  const toolingPath = path.join(dir, ".swytchcode", "tooling.json");
  const manifestPath = path.join(dir, ".swytchcode", "integrations", "manifest.json");
  const policiesPath = path.join(dir, ".swytchcode", "integrations", "policies.json");
  const mtimes = await Promise.all(
    [toolingPath, manifestPath, policiesPath].map((p) =>
      stat(/*turbopackIgnore: true*/ p).then(
        (s) => s.mtimeMs,
        () => 0,
      ),
    ),
  );
  const key = `${dir}|${mtimes.join("|")}`;
  if (cache?.key === key) return cache.project;

  if (mtimes[0] === 0) throw new Error(`No Swytchcode project at ${dir} (missing .swytchcode/tooling.json). Run: swy init`);
  const tooling = ToolingSchema.parse(await readJson(toolingPath));
  const manifest = mtimes[1] ? ManifestSchema.parse(await readJson(manifestPath)) : {};
  const policies = mtimes[2] ? PoliciesFileSchema.parse(await readJson(policiesPath)).policies : [];
  const project: SwytchProject = {
    dir,
    mode: tooling.mode ?? "sandbox",
    enabledTools: new Set(Object.keys(tooling.tools ?? {})),
    integrations: new Set(Object.entries(tooling.integrations ?? {}).map(([k, v]) => `${k}@${v.version}`)),
    manifest,
    policies,
  };
  cache = { key, project };
  return project;
}
