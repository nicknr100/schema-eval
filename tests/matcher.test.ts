import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultMatcherFor, scoreCase } from "../src/matcher.ts";

describe("defaultMatcherFor", () => {
  it("picks fuzzy string matching for z.string()", () => {
    const { matcher, name } = defaultMatcherFor(z.string());
    expect(name).toBe("fuzzy-string");
    expect(matcher("Algorithms", "algorithms")).toBe(true);
    expect(matcher("Tuesday evening", "Tuesday evenings")).toBe(true);
    expect(matcher("Algorithms", "Economics")).toBe(false);
  });

  it("unwraps optional/nullable/default before picking a matcher", () => {
    expect(defaultMatcherFor(z.string().optional()).name).toBe("fuzzy-string");
    expect(defaultMatcherFor(z.string().nullable()).name).toBe("fuzzy-string");
    expect(defaultMatcherFor(z.array(z.string()).default([])).name).toBe("array-of-fuzzy-string");
  });

  it("picks exact matching for numbers and booleans", () => {
    expect(defaultMatcherFor(z.number()).matcher(3, 3)).toBe(true);
    expect(defaultMatcherFor(z.number()).matcher(3, 4)).toBe(false);
    expect(defaultMatcherFor(z.boolean()).matcher(true, true)).toBe(true);
  });

  it("picks array-containment matching: every expected element must appear somewhere in actual", () => {
    const { matcher } = defaultMatcherFor(z.array(z.string()));
    expect(matcher(["algorithms"], ["Statistics", "Algorithms", "Economics"])).toBe(true);
    expect(matcher(["Algorithms", "Statistics"], ["Statistics", "Algorithms", "Economics"])).toBe(true);
    expect(matcher(["Biology"], ["Statistics", "Algorithms"])).toBe(false);
    expect(matcher(["Algorithms", "Biology"], ["Statistics", "Algorithms"])).toBe(false);
  });

  it("tolerates a bare scalar expected value for an array field", () => {
    const { matcher } = defaultMatcherFor(z.array(z.string()));
    expect(matcher("algorithms", ["Statistics", "Algorithms"])).toBe(true);
  });

  it("falls back to deep-equal for a type it doesn't have a specific rule for", () => {
    const { matcher, name } = defaultMatcherFor(z.object({ a: z.string() }));
    expect(name).toContain("fallback");
    expect(matcher({ a: "x" }, { a: "x" })).toBe(true);
    expect(matcher({ a: "x" }, { a: "y" })).toBe(false);
  });
});

describe("scoreCase", () => {
  const schema = z.object({
    course_terms: z.array(z.string()),
    preferred_years: z.array(z.number()),
    summary: z.string(),
  });

  it("matches expected fields against the actual object, field by field", () => {
    const fields = scoreCase(
      schema,
      { course_terms: ["Algorithms"], preferred_years: [2] },
      { course_terms: ["algorithms"], preferred_years: [2], summary: "unrelated, not checked" },
    );

    expect(fields).toHaveLength(2);
    expect(fields.every((f) => f.matched)).toBe(true);
  });

  it("reports which specific field failed, not just pass/fail overall", () => {
    const fields = scoreCase(
      schema,
      { course_terms: ["Algorithms"], preferred_years: [3] },
      { course_terms: ["algorithms"], preferred_years: [2] },
    );

    const byField = Object.fromEntries(fields.map((f) => [f.field, f.matched]));
    expect(byField.course_terms).toBe(true);
    expect(byField.preferred_years).toBe(false);
  });

  it("never penalises fields the model returned that nobody asked about", () => {
    const fields = scoreCase(schema, { summary: "a summary" }, { summary: "a summary", course_terms: ["anything"] });
    expect(fields).toHaveLength(1);
    expect(fields[0].matched).toBe(true);
  });

  it("respects a per-field override matcher over the schema-derived default", () => {
    const alwaysTrue = () => true;
    const fields = scoreCase(schema, { summary: "expected text" }, { summary: "completely different" }, { summary: alwaysTrue });
    expect(fields[0].matched).toBe(true);
    expect(fields[0].matcher).toBe("override");
  });
});
