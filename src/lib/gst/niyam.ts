import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

/**
 * GST rule lookup through Niyam (github.com/jatinvats123/niyam), which answers from all 272 official
 * CBIC GST circulars. Bahi talks to Niyam's MCP server over stdio and only uses its search tool, so
 * Niyam needs no LLM key; Bahi's own model writes the answer from the cited passages.
 */

const passageSchema = z.object({
  circular: z.string(),
  date: z.string(),
  subject: z.string(),
  pages: z.string(),
  text: z.string(),
});

export type GstPassage = z.infer<typeof passageSchema>;

export interface GstLookup {
  search(question: string, k: number): Promise<GstPassage[]>;
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: { result?: unknown };
  content?: Array<{ type: string; text?: string }>;
};

/**
 * Read a search_circulars result. FastMCP sends a list both as structured content ({ result: [...] })
 * and as text (one JSON item per entry, or one JSON array), depending on the SDK version.
 */
export function parsePassages(raw: unknown): GstPassage[] {
  const result = raw as ToolResult;
  const texts = (result.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text as string);
  if (result.isError) throw new Error(texts.join(" ") || "Niyam returned an error");
  let items: unknown[] = [];
  if (Array.isArray(result.structuredContent?.result)) {
    items = result.structuredContent.result;
  } else {
    for (const text of texts) {
      const parsed: unknown = JSON.parse(text);
      items.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
  }
  return z.array(passageSchema).parse(items);
}

let shared: { key: string; client: Promise<Client> } | null = null;

async function connect(command: string, args: string[], cwd: string | undefined): Promise<Client> {
  const client = new Client({ name: "bahi", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command, args, ...(cwd ? { cwd } : {}), stderr: "ignore" }));
  return client;
}

/**
 * Niyam over MCP, configured by NIYAM_MCP_COMMAND (the Python in Niyam's venv), NIYAM_MCP_ARGS
 * (default "-m niyam.mcp_server") and NIYAM_MCP_CWD (Niyam's folder). Returns null when not
 * configured, so Bahi runs exactly as before without it. One connection is shared across runs.
 */
export function niyamFromEnv(env: Record<string, string | undefined> = process.env): GstLookup | null {
  const command = env.NIYAM_MCP_COMMAND?.trim();
  if (!command) return null;
  const args = (env.NIYAM_MCP_ARGS?.trim() || "-m niyam.mcp_server").split(/\s+/);
  const cwd = env.NIYAM_MCP_CWD?.trim() || undefined;
  const key = [command, ...args, cwd ?? ""].join("\u0000");

  return {
    async search(question: string, k: number): Promise<GstPassage[]> {
      if (!shared || shared.key !== key) shared = { key, client: connect(command, args, cwd) };
      try {
        const client = await shared.client;
        // The first call loads Niyam's embedding model, which takes a few seconds.
        const result = await client.callTool({ name: "search_circulars", arguments: { query: question, k } }, undefined, { timeout: 120_000 });
        return parsePassages(result);
      } catch (error) {
        shared = null; // reconnect next time instead of reusing a dead process
        throw error;
      }
    },
  };
}
