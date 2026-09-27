import type { z } from "zod";

/** How the tool actually calls a model. Gemini is the only implementation
 * today; anything with this shape can be swapped in — the scorer and CLI
 * never depend on Gemini specifically. */
export type Provider = {
  name: string;
  call(args: {
    model: string;
    systemInstruction: string;
    input: string;
    schema: z.ZodTypeAny;
  }): Promise<unknown>;
};

/** One (input, expected output) pair. `expected` only needs to name the
 * fields a case actually cares about — anything the model returns beyond
 * that is not penalised. */
export type TestCase = {
  input: string;
  expected: Record<string, unknown>;
};

/** Override the default per-type matcher for a specific field, when the
 * built-in heuristic (see matcher.ts) isn't right for it. */
export type FieldMatcher = (expected: unknown, actual: unknown) => boolean;

export type EvalConfig = {
  model: string;
  systemInstruction: string;
  /** The same schema you use to ask the model for structured output. Field
   * types on this schema (string, array of string, number, boolean) pick the
   * default matcher for that field — see matcher.ts. */
  responseSchema: z.ZodTypeAny;
  /** Path to a JSON file of TestCase[], resolved relative to the config file. */
  cases: string;
  /** Fraction of expected fields that must match for the run to pass. */
  threshold?: number;
  matchers?: Record<string, FieldMatcher>;
  provider?: Provider;
};

export function defineConfig(config: EvalConfig): EvalConfig {
  return config;
}

export type FieldResult = {
  field: string;
  expected: unknown;
  actual: unknown;
  matched: boolean;
  matcher: string;
};

export type CaseResult = {
  case: TestCase;
  actual: unknown;
  error?: string;
  fields: FieldResult[];
};

export type Report = {
  results: CaseResult[];
  expectedFieldCount: number;
  matchedFieldCount: number;
  score: number;
  passed: boolean;
};
