import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { scoreCase } from "./matcher.ts";
import { geminiProvider } from "./providers/gemini.ts";
import type { CaseResult, EvalConfig, Report, TestCase } from "./types.ts";

export { defineConfig } from "./types.ts";
export type { EvalConfig, Provider, TestCase, FieldMatcher, Report } from "./types.ts";
export { scoreCase, defaultMatcherFor } from "./matcher.ts";
export { geminiProvider } from "./providers/gemini.ts";

/** Loads a `schema-eval.config.ts` (or any path ending in .ts/.js) via a
 * plain dynamic import. Node's own type-stripping support (22.6+, no flag
 * needed from Node 23.6 on) is what makes this work without a separate
 * loader — the same reason the config format is a real .ts module and not
 * JSON: it needs to hold a live zod schema, not a serialised one. */
async function loadConfig(configPath: string): Promise<{ config: EvalConfig; dir: string }> {
  const absolute = resolve(configPath);
  const mod = await import(absolute);
  const config = (mod.default ?? mod) as EvalConfig;
  if (!config?.responseSchema) {
    throw new Error(`${configPath} does not export a config with a responseSchema — did you forget "export default"?`);
  }
  return { config, dir: dirname(absolute) };
}

async function loadCases(casesPath: string, configDir: string): Promise<TestCase[]> {
  const absolute = resolve(configDir, casesPath);
  const raw = await readFile(absolute, "utf8");
  return JSON.parse(raw) as TestCase[];
}

/** Runs every case in `config.cases` against `config.provider` (Gemini by
 * default) and scores the result. This is the one function both the CLI and
 * a consumer's own script (e.g. inside CI, or a notebook) call. */
export async function runEval(configPath: string): Promise<Report> {
  const { config, dir } = await loadConfig(configPath);
  const cases = await loadCases(config.cases, dir);
  const provider = config.provider ?? geminiProvider;
  const threshold = config.threshold ?? 0.8;

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    try {
      const actual = await provider.call({
        model: config.model,
        systemInstruction: config.systemInstruction,
        input: testCase.input,
        schema: config.responseSchema,
      });
      const fields = scoreCase(config.responseSchema, testCase.expected, actual, config.matchers);
      results.push({ case: testCase, actual, fields });
    } catch (err) {
      results.push({ case: testCase, actual: undefined, error: (err as Error).message, fields: [] });
    }
  }

  const expectedFieldCount = results.reduce((sum, r) => sum + r.fields.length, 0);
  const matchedFieldCount = results.reduce((sum, r) => sum + r.fields.filter((f) => f.matched).length, 0);
  const erroredCount = results.filter((r) => r.error).length;

  // A run where every case errored (bad API key, network down, model
  // unreachable) has nothing to score — that must never read as "passed",
  // even though 0/0 matched is otherwise vacuously 100%.
  const score = expectedFieldCount === 0 ? (erroredCount === results.length ? 0 : 1) : matchedFieldCount / expectedFieldCount;
  const passed = erroredCount === 0 && score >= threshold;

  return { results, expectedFieldCount, matchedFieldCount, score, passed };
}

export function formatReport(report: Report): string {
  const lines: string[] = [];

  report.results.forEach((result, index) => {
    if (result.error) {
      lines.push(`${index + 1}. ERROR  "${result.case.input}"  (${result.error})`);
      return;
    }
    const missing = result.fields.filter((f) => !f.matched);
    if (missing.length === 0) {
      lines.push(`${index + 1}. PASS   "${result.case.input}"`);
    } else {
      lines.push(`${index + 1}. FAIL   "${result.case.input}"`);
      for (const field of missing) {
        lines.push(`        ${field.field} (${field.matcher}): expected ${JSON.stringify(field.expected)}, got ${JSON.stringify(field.actual)}`);
      }
    }
  });

  lines.push("");
  lines.push(
    `${report.matchedFieldCount}/${report.expectedFieldCount} expected fields matched ` +
      `(${(report.score * 100).toFixed(1)}%) — ${report.passed ? "PASS" : "FAIL"}`,
  );

  return lines.join("\n");
}
