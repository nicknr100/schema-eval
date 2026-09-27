import { zodToJsonSchema } from "zod-to-json-schema";
import type { Provider } from "../types.ts";

type GeminiInteraction = {
  status?: string;
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractText(interaction: GeminiInteraction): string {
  const modelOutput = [...(interaction.steps ?? [])].reverse().find((step) => step.type === "model_output");
  return (modelOutput?.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

/**
 * Calls Gemini's structured-output endpoint. The JSON schema sent to the API
 * is derived from the same zod schema the config declares for scoring
 * (`zod-to-json-schema`), so there is exactly one schema to keep in sync,
 * not two.
 */
export const geminiProvider: Provider = {
  name: "gemini",
  async call({ model, systemInstruction, input, schema }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        model,
        system_instruction: systemInstruction,
        input,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: zodToJsonSchema(schema, { target: "openApi3" }),
        },
        generation_config: { max_output_tokens: 512, thinking_level: "minimal" },
        store: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);

    const interaction = (await response.json()) as GeminiInteraction;
    if (interaction.status && interaction.status !== "completed") {
      throw new Error(`Gemini interaction did not complete: ${interaction.status}`);
    }

    const text = extractText(interaction);
    if (!text) throw new Error("Gemini returned no output text");

    return JSON.parse(text);
  },
};
