import { test, expect, describe } from "bun:test";
import { ExactMatchAnalyzer } from "../src/analyzer/exact-match";
import type { GroundTruth } from "../src/types";

describe("ExactMatchAnalyzer", () => {
  const analyzer = new ExactMatchAnalyzer();

  test("returns 1.0 for exact match (case insensitive)", async () => {
    const result = await analyzer.analyze(
      "Yes, Vitamin B12 is available.",
      "Yes, Vitamin B12 is available."
    );
    expect(result.strategy).toBe("exact");
    expect(result.score).toBe(1.0);
  });

  test("returns 1.0 for same text with different casing", async () => {
    const result = await analyzer.analyze(
      "yes, vitamin b12 is available",
      "Yes, Vitamin B12 is available"
    );
    expect(result.score).toBe(1.0);
  });

  test("returns 0.8 when response contains full expected answer", async () => {
    const result = await analyzer.analyze(
      "Absolutely! Yes, Vitamin B12 is available at our clinic pharmacy.",
      "Yes, Vitamin B12 is available"
    );
    expect(result.score).toBe(0.8);
  });

  test("returns partial score for word overlap (no keywords)", async () => {
    const result = await analyzer.analyze(
      "We have B12 supplements in stock.",
      "Vitamin B12 is available at our clinic"
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.8);
  });

  test("returns low score for completely different text", async () => {
    const result = await analyzer.analyze(
      "The weather is nice today",
      "Vitamin B12 is available"
    );
    expect(result.score).toBeLessThan(0.3);
  });

  test("sets groundTruth in result", async () => {
    const result = await analyzer.analyze("response", "expected");
    expect(result.groundTruth).toBe("expected");
  });

  test("isHumanNeed is false for exact match", async () => {
    const result = await analyzer.analyze("test", "test");
    expect(result.isHumanNeed).toBe(false);
  });

  // -- Keyword-based tests --

  test("scores high when all required keywords present", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Insulin Glargine is available at ₹850. It requires a prescription.",
      requiredKeywords: ["850", "prescription"],
    };
    const result = await analyzer.analyze(
      "Yes, Insulin Glargine costs ₹850 and you need a prescription.",
      gt.expectedAnswer,
      gt
    );
    expect(result.score).toBeGreaterThan(0.8);
  });

  test("scores low when required keywords missing", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Insulin Glargine is available at ₹850. It requires a prescription.",
      requiredKeywords: ["850", "prescription"],
    };
    const result = await analyzer.analyze(
      "Yes, we have Insulin Glargine available.",
      gt.expectedAnswer,
      gt
    );
    expect(result.score).toBeLessThan(0.5);
  });

  test("scores partial when some keywords match", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Insulin Glargine is available at ₹850. It requires a prescription.",
      requiredKeywords: ["850", "prescription"],
    };
    const result = await analyzer.analyze(
      "Insulin Glargine costs ₹850.",
      gt.expectedAnswer,
      gt
    );
    // 1 of 2 keywords matched
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.score).toBeLessThan(0.8);
  });

  test("does not confuse different numbers", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Our emergency number is +91 80 1234 9999.",
      requiredKeywords: ["1234 9999"],
    };
    const result = await analyzer.analyze(
      "Our phone number is +91 80 1234 5678.",
      gt.expectedAnswer,
      gt
    );
    // "1234 9999" is NOT in the response (it has "1234 5678")
    expect(result.score).toBeLessThan(0.2);
  });

  test("matches proper nouns correctly", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Dr. Anjali Nair is our Dermatologist.",
      requiredKeywords: ["anjali nair", "dermatologist"],
    };
    const result = await analyzer.analyze(
      "For skin issues, see Dr. Anjali Nair, our Dermatologist.",
      gt.expectedAnswer,
      gt
    );
    expect(result.score).toBeGreaterThan(0.8);
  });

  test("flags human review when less than half keywords match", async () => {
    const gt: GroundTruth = {
      expectedAnswer: "Dr. Sharma is available Monday, Wednesday, Friday.",
      requiredKeywords: ["monday", "wednesday", "friday"],
    };
    const result = await analyzer.analyze(
      "Dr. Sharma sees patients on some weekdays.",
      gt.expectedAnswer,
      gt
    );
    expect(result.isHumanNeed).toBe(true);
  });
});
