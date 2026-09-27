import { z } from "zod";

/**
 * Adapted from the real extraction schema behind AI Study Match in Waseda
 * Study Hub (github.com/Waseda-Study-Hub/frontend) — the feature this tool
 * was generalized out of. The model extracts these fields from a student's
 * free-text request; deterministic code then ranks real profiles against
 * them, so this schema is the entire contract between "ambiguous language"
 * and "code that has to be reproducible".
 */
export const studyMatchSchema = z.object({
  summary: z.string().describe("A short, plain-language restatement of the student's request."),
  preferred_years: z
    .array(z.number().int().min(1).max(5))
    .describe("Explicitly requested study years. 5 means graduate students. Empty means any year."),
  course_terms: z.array(z.string()).describe("Course codes or course names explicitly requested."),
  major_terms: z.array(z.string()).describe("Majors or fields of study explicitly requested."),
  availability_terms: z.array(z.string()).describe("Requested days, times, or availability phrases, kept concise."),
  preference_terms: z
    .array(z.string())
    .describe("Requested study-style terms such as quiet, group study, or beginner-friendly."),
});
