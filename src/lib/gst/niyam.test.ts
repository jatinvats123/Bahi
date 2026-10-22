import { describe, expect, it } from "vitest";
import { niyamFromEnv, parsePassages } from "./niyam";

const passage = {
  n: 1,
  circular: "230/24/2024-GST",
  date: "2024-09-11",
  subject: "Clarification in respect of advertising services provided to foreign clients.",
  pages: "pages 1-2",
  text: "Advertising services provided to foreign clients qualify as export of services ...",
  score: 0.91,
};
const expected = { circular: passage.circular, date: passage.date, subject: passage.subject, pages: passage.pages, text: passage.text };

describe("parsePassages", () => {
  it("reads structured content", () => {
    expect(parsePassages({ structuredContent: { result: [passage] }, content: [] })).toEqual([expected]);
  });

  it("reads one JSON text item per passage, or one JSON array", () => {
    const perItem = { content: [{ type: "text", text: JSON.stringify(passage) }, { type: "text", text: JSON.stringify(passage) }] };
    expect(parsePassages(perItem)).toEqual([expected, expected]);
    expect(parsePassages({ content: [{ type: "text", text: JSON.stringify([passage]) }] })).toEqual([expected]);
  });

  it("returns nothing for an empty result", () => {
    expect(parsePassages({ structuredContent: { result: [] } })).toEqual([]);
  });

  it("throws on a tool error or an unexpected shape", () => {
    expect(() => parsePassages({ isError: true, content: [{ type: "text", text: "model failed to load" }] })).toThrow("model failed to load");
    expect(() => parsePassages({ structuredContent: { result: [{ circular: 1 }] } })).toThrow();
  });
});

describe("niyamFromEnv", () => {
  it("is off unless NIYAM_MCP_COMMAND is set", () => {
    expect(niyamFromEnv({})).toBeNull();
    expect(niyamFromEnv({ NIYAM_MCP_COMMAND: "  " })).toBeNull();
    expect(niyamFromEnv({ NIYAM_MCP_COMMAND: "python" })).not.toBeNull();
  });
});
