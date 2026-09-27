import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runEval } from "../src/index.ts";
import type { Provider, TestCase } from "../src/types.ts";

/** Directory shared by the "bad input" tests below, so each fixture doesn't
 * need its own throwaway provider/schema wiring. */
async function tempDir() {
  return mkdtemp(join(tmpdir(), "schema-eval-test-"));
}

/** Writes a config + cases file to a temp dir and returns the config path,
 * so runEval can be exercised through its real file-loading path (dynamic
 * import + JSON read) rather than only unit-testing the pieces in isolation. */
async function writeFixture(cases: TestCase[], provider: Provider) {
  const dir = await mkdtemp(join(tmpdir(), "schema-eval-test-"));
  await writeFile(join(dir, "cases.json"), JSON.stringify(cases));

  // The provider is a function; it can't survive being written to disk as
  // JSON, so it's injected as a module-scoped variable the written config
  // file imports back out — this keeps the fixture using the real
  // dynamic-import config-loading path end to end.
  (globalThis as Record<string, unknown>).__testProvider = provider;
  await writeFile(
    join(dir, "schema-eval.config.ts"),
    `
    export default {
      model: "test-model",
      systemInstruction: "unused in this test",
      responseSchema: (globalThis).__testSchema,
      cases: "./cases.json",
      threshold: 0.8,
      provider: (globalThis).__testProvider,
    };
    `,
  );
  (globalThis as Record<string, unknown>).__testSchema = z.object({ value: z.string() });

  return join(dir, "schema-eval.config.ts");
}

describe("runEval — pass/fail semantics", () => {
  it("never reports pass when every case errored, even though 0/0 matched is vacuously 100%", async () => {
    const alwaysErrors: Provider = {
      name: "always-errors",
      call: async () => {
        throw new Error("simulated network failure");
      },
    };
    const configPath = await writeFixture([{ input: "x", expected: {} }], alwaysErrors);

    const report = await runEval(configPath);
    expect(report.passed).toBe(false);
    expect(report.results[0].error).toContain("simulated network failure");
  });

  it("passes when every case succeeds and the score clears the threshold", async () => {
    const alwaysCorrect: Provider = {
      name: "always-correct",
      call: async () => ({ value: "expected-value" }),
    };
    const configPath = await writeFixture([{ input: "x", expected: { value: "expected-value" } }], alwaysCorrect);

    const report = await runEval(configPath);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(1);
  });

  it("fails when even one case errors, regardless of how well the rest scored", async () => {
    let call = 0;
    const flaky: Provider = {
      name: "flaky",
      call: async () => {
        call++;
        if (call === 1) throw new Error("simulated failure on case 1");
        return { value: "expected-value" };
      },
    };
    const configPath = await writeFixture(
      [
        { input: "a", expected: { value: "expected-value" } },
        { input: "b", expected: { value: "expected-value" } },
      ],
      flaky,
    );

    const report = await runEval(configPath);
    expect(report.passed).toBe(false);
  });
});

describe("runEval — clean errors instead of raw Node errors", () => {
  it("names the exact resolved path when the config file doesn't exist", async () => {
    await expect(runEval("/definitely/does/not/exist/schema-eval.config.ts")).rejects.toThrow(/Config file not found:.*schema-eval\.config\.ts/);
  });

  it("explains a config that forgot 'export default', rather than crashing on a missing field", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "schema-eval.config.ts"), `export const config = { model: "x" };`);

    await expect(runEval(join(dir, "schema-eval.config.ts"))).rejects.toThrow(/does not export a config with a responseSchema/);
  });

  it("names the exact resolved path when the cases file doesn't exist", async () => {
    const dir = await tempDir();
    (globalThis as Record<string, unknown>).__testSchema2 = z.object({ value: z.string() });
    await writeFile(
      join(dir, "schema-eval.config.ts"),
      `export default { model: "x", systemInstruction: "x", responseSchema: globalThis.__testSchema2, cases: "./missing.json" };`,
    );

    await expect(runEval(join(dir, "schema-eval.config.ts"))).rejects.toThrow(/Cases file not found:.*missing\.json/);
  });

  it("says which file is bad JSON, instead of a bare SyntaxError with no filename", async () => {
    const dir = await tempDir();
    (globalThis as Record<string, unknown>).__testSchema3 = z.object({ value: z.string() });
    await writeFile(join(dir, "cases.json"), "{ this is not json");
    await writeFile(
      join(dir, "schema-eval.config.ts"),
      `export default { model: "x", systemInstruction: "x", responseSchema: globalThis.__testSchema3, cases: "./cases.json" };`,
    );

    await expect(runEval(join(dir, "schema-eval.config.ts"))).rejects.toThrow(/cases\.json is not valid JSON/);
  });
});
