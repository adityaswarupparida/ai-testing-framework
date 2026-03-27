import type { GroundTruth } from "../types";
import type { AnalysisResult, AnalysisStrategy } from "../types/analyzer";

export class ExactMatchAnalyzer implements AnalysisStrategy {
  async analyze(response: string, expected: string, groundTruth?: GroundTruth): Promise<AnalysisResult> {
    const normalizedResponse = this.normalize(response);
    const normalizedExpected = this.normalize(expected);

    // 1. Full exact match
    if (normalizedResponse === normalizedExpected) {
      return { strategy: "exact", score: 1.0, groundTruth: expected, isHumanNeed: false };
    }

    // 2. Response contains the full expected answer
    if (normalizedResponse.includes(normalizedExpected)) {
      return { strategy: "exact", score: 0.8, groundTruth: expected, isHumanNeed: false };
    }

    // 3. Keyword-based scoring (primary method when keywords exist)
    const keywords = groundTruth?.requiredKeywords || [];
    if (keywords.length > 0) {
      const keywordScore = this.scoreKeywords(response, keywords);

      // Also check acceptable variations
      const variationBonus = this.scoreVariations(response, groundTruth?.acceptableVariations || []);

      // Keywords are the primary signal, variation match is a bonus
      const score = Math.min(1.0, keywordScore * 0.85 + variationBonus * 0.15);
      return { strategy: "exact", score, groundTruth: expected, isHumanNeed: keywordScore < 0.5 };
    }

    // 4. Fallback: word overlap against expected answer
    const score = this.wordOverlapScore(normalizedResponse, normalizedExpected);
    return { strategy: "exact", score, groundTruth: expected, isHumanNeed: false };
  }

  /**
   * Scores each required keyword independently.
   * Uses case-insensitive matching on the raw response (preserving special chars)
   * so "₹850", "+91 80 1234 9999", "Dr. Sharma" are matched accurately.
   */
  private scoreKeywords(response: string, keywords: string[]): number {
    const lowerResponse = response.toLowerCase();
    let matched = 0;

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      if (lowerResponse.includes(lowerKeyword)) {
        matched++;
      }
    }

    return keywords.length > 0 ? matched / keywords.length : 0;
  }

  /**
   * Checks if the response matches any acceptable variation.
   * Returns 1.0 if any variation is found in the response, 0.0 otherwise.
   */
  private scoreVariations(response: string, variations: string[]): number {
    const lowerResponse = response.toLowerCase();
    for (const variation of variations) {
      if (lowerResponse.includes(variation.toLowerCase())) {
        return 1.0;
      }
    }
    return 0.0;
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private wordOverlapScore(response: string, expected: string): number {
    const expectedWords = expected.split(" ").filter((w) => w.length > 2); // skip tiny words
    if (expectedWords.length === 0) return 0;
    const matchedWords = expectedWords.filter((word) => response.includes(word));
    return matchedWords.length / expectedWords.length;
  }
}
