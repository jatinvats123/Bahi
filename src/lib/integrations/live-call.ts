import "server-only";
import type { z } from "zod";
import type { ExecError } from "../swytch/errors";
import { execTool, type ExecInput } from "../swytch/runtime";
import { TOOLS, type ToolKey } from "../swytch/tools";
import { failure, success, type Outcome } from "./result";
import type { CallCtx } from "./types";

export interface LiveCallOpts {
  ctx?: CallCtx;
  /** Timeline line for this call; keep it free of secrets. */
  summary?: string;
  what?: string;
  /** Provider-level failure hidden in a 200 response (checked before the schema). */
  check?: (data: unknown) => ExecError | null;
}

/**
 * One Swytchcode call from a live adapter: execTool, then zod-parse the response.
 * Checks run inside the runtime, so a bad response is reported as a failed
 * tool_result in the timeline, not as a success.
 */
export async function liveCall<S extends z.ZodType>(key: ToolKey, input: ExecInput, schema: S, opts: LiveCallOpts = {}): Promise<Outcome<z.infer<S>>> {
  const def = TOOLS[key];
  const what = opts.what ?? def.id;
  let parsed: z.infer<S> | undefined;
  const r = await execTool(def.id, input, {
    onEvent: opts.ctx?.onEvent,
    callId: opts.ctx?.callId,
    inputSummary: opts.summary,
    validate: (data) => {
      const early = opts.check?.(data);
      if (early) return early;
      const p = schema.safeParse(data);
      if (!p.success) {
        const issue = p.error.issues[0];
        return { kind: "provider", message: `Unexpected ${what} response${issue ? ` (${issue.path.join(".") || "root"}: ${issue.message})` : ""}` };
      }
      parsed = p.data;
      return null;
    },
  });
  if (!r.ok) return failure(r.error, r.ms);
  return success(parsed as z.infer<S>, r.ms);
}
