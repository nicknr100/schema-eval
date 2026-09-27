import { z } from "zod";
import type { FieldMatcher, FieldResult } from "./types.ts";

/** Loose text compare: casing, surrounding space, and a trailing plural
 * shouldn't count as a miss. Carried over unchanged from the eval this tool
 * generalizes (originally written for a study-partner-matching feature). */
function normalise(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ").replace(/s$/, "");
}

function fuzzyStringMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected !== "string" || typeof actual !== "string") return false;
  const want = normalise(expected);
  const got = normalise(actual);
  return got === want || got.includes(want) || want.includes(got);
}

function exactMatch(expected: unknown, actual: unknown): boolean {
  return expected === actual;
}

function deepEqualFallback(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

/** For an array-typed field, `expected` is itself an array (e.g.
 * `course_terms: ["Algorithms"]`) — this checks that *every* expected element
 * has some matching element in `actual`, under `elementMatcher`. Order
 * doesn't matter, and extra elements in `actual` are never penalised. A bare
 * scalar `expected` (not an array) is tolerated by treating it as a
 * single-element array. */
function arrayContainsMatch(elementMatcher: FieldMatcher): FieldMatcher {
  return (expected, actual) => {
    if (!Array.isArray(actual)) return false;
    const expectedElements = Array.isArray(expected) ? expected : [expected];
    return expectedElements.every((item) => actual.some((candidate) => elementMatcher(item, candidate)));
  };
}

/** Unwraps ZodOptional/ZodDefault/ZodNullable to get at the real inner type,
 * since a field is usually declared as `z.array(z.string()).optional()`, not
 * bare `z.array(z.string())`. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrap(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return unwrap(schema._def.innerType);
  }
  return schema;
}

/**
 * Picks a default matcher for a field purely from its zod type — this is
 * the piece that lets one schema drive both what's asked of the model
 * (via zod-to-json-schema, see provider.ts) and how the answer is scored,
 * instead of a scorer that has to be rewritten per project.
 */
export function defaultMatcherFor(schema: z.ZodTypeAny): { matcher: FieldMatcher; name: string } {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodString) return { matcher: fuzzyStringMatch, name: "fuzzy-string" };
  if (inner instanceof z.ZodNumber || inner instanceof z.ZodBoolean) {
    return { matcher: exactMatch, name: "exact" };
  }
  if (inner instanceof z.ZodArray) {
    const { matcher: elementMatcher, name } = defaultMatcherFor(inner.element);
    return { matcher: arrayContainsMatch(elementMatcher), name: `array-of-${name}` };
  }
  return { matcher: deepEqualFallback, name: "deep-equal (fallback)" };
}

/**
 * Scores one test case's `expected` fields against what the model actually
 * returned. Only fields named in `expected` are checked — fields the model
 * returns that nobody asked about are never penalised, matching the spirit
 * of "did it get what we care about right", not "did it match exactly".
 */
export function scoreCase(
  responseSchema: z.ZodTypeAny,
  expected: Record<string, unknown>,
  actual: unknown,
  overrides: Record<string, FieldMatcher> = {},
): FieldResult[] {
  const shape = responseSchema instanceof z.ZodObject ? responseSchema.shape : {};
  const actualObj = (actual && typeof actual === "object" ? actual : {}) as Record<string, unknown>;

  return Object.entries(expected).map(([field, expectedValue]) => {
    const actualValue = actualObj[field];
    const override = overrides[field];
    const fieldSchema = shape[field];

    const { matcher, name } = override
      ? { matcher: override, name: "override" }
      : fieldSchema
        ? defaultMatcherFor(fieldSchema)
        : { matcher: deepEqualFallback, name: "deep-equal (field not in schema)" };

    return {
      field,
      expected: expectedValue,
      actual: actualValue,
      matched: matcher(expectedValue, actualValue),
      matcher: name,
    };
  });
}
