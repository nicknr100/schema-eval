import { describe, expect, it } from "vitest";
import { extractText, type GeminiInteraction } from "../src/providers/gemini.ts";

describe("extractText", () => {
  it("joins the text content of the last model_output step", () => {
    const interaction: GeminiInteraction = {
      status: "completed",
      steps: [
        { type: "tool_call", content: [{ type: "text", text: "should be ignored" }] },
        { type: "model_output", content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }] },
      ],
    };
    expect(extractText(interaction)).toBe('{"a":1}');
  });

  it("uses the last model_output step when there is more than one", () => {
    const interaction: GeminiInteraction = {
      steps: [
        { type: "model_output", content: [{ type: "text", text: "stale, superseded" }] },
        { type: "model_output", content: [{ type: "text", text: "final answer" }] },
      ],
    };
    expect(extractText(interaction)).toBe("final answer");
  });

  it("ignores non-text content items within the model_output step", () => {
    const interaction: GeminiInteraction = {
      steps: [
        {
          type: "model_output",
          content: [{ type: "tool_use" }, { type: "text", text: "kept" }],
        },
      ],
    };
    expect(extractText(interaction)).toBe("kept");
  });

  it("returns an empty string when there is no model_output step at all", () => {
    expect(extractText({ steps: [{ type: "tool_call", content: [{ type: "text", text: "x" }] }] })).toBe("");
    expect(extractText({})).toBe("");
  });
});
