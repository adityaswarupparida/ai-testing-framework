import type { ConversationTurn, GroundTruth } from "../types";
import type { AnalysisResult, ResponseAnalyzer } from "../types/analyzer";
import { ExactMatchAnalyzer } from "./exact-match";
import { SemanticSimilarityAnalyzer } from "./semantic-similarity";
import type { EmbeddingGenerator } from "./embedding-generator";

export interface CompositeWeights {
  exact: number;
  semantic: number;
}

// Patterns that indicate the answer requires specific factual content
const NUMBER_PATTERN = /\d+/;
const PRICE_PATTERN = /[₹$€£]\d+|\d+\s*(rs|rupee|inr)/i;
const TIME_PATTERN = /\d{1,2}[:.]\d{2}\s*(am|pm)?/i;
const PHONE_PATTERN = /\+?\d[\d\s-]{6,}/;
const PROPER_NOUN_PATTERN = /\b(dr\.?|doctor)\s+\w+/i;

export class CompositeAnalyzer implements ResponseAnalyzer {
  private exactAnalyzer: ExactMatchAnalyzer;
  private semanticAnalyzer: SemanticSimilarityAnalyzer;
  private defaultWeights: CompositeWeights;

  constructor(embedder: EmbeddingGenerator, defaultWeights: CompositeWeights = { exact: 0.7, semantic: 0.3 }) {
    this.exactAnalyzer = new ExactMatchAnalyzer();
    this.semanticAnalyzer = new SemanticSimilarityAnalyzer(embedder);
    this.defaultWeights = defaultWeights;
  }

  async analyzeAll(
    turns: ConversationTurn[],
    groundTruths: GroundTruth[]
  ): Promise<AnalysisResult[]> {
    const results: AnalysisResult[] = [];

    for (const turn of turns) {
      if (turn.type !== "seed") continue;

      const groundTruth = groundTruths.find(
        (_, idx) => turns.filter((t) => t.type === "seed")[idx]?.question === turn.question
      );

      if (!groundTruth) continue;

      const weights = this.computeWeights(groundTruth);

      const [exactResult, semanticResult] = await Promise.all([
        this.exactAnalyzer.analyze(turn.response, groundTruth.expectedAnswer, groundTruth),
        this.semanticAnalyzer.analyze(turn.response, groundTruth.expectedAnswer),
      ]);

      results.push(exactResult);
      results.push(semanticResult);

      const compositeScore =
        exactResult.score * weights.exact +
        semanticResult.score * weights.semantic;

      results.push({
        strategy: "composite",
        score: compositeScore,
        groundTruth: groundTruth.expectedAnswer,
        isHumanNeed: compositeScore < 0.5,
      });
    }

    return results;
  }

  /**
   * Determines weights per question based on ground truth content.
   *
   * - Numbers, prices, times, phone numbers, proper nouns in keywords → exact-heavy (0.8/0.2)
   * - Generic keywords only ("yes", "available", "no") → semantic-heavy (0.2/0.8)
   * - No keywords at all → pure semantic (0.1/0.9)
   */
  private computeWeights(groundTruth: GroundTruth): CompositeWeights {
    const keywords = groundTruth.requiredKeywords || [];

    if (keywords.length === 0) {
      return { exact: 0.1, semantic: 0.9 };
    }

    const hasSpecificContent = keywords.some((kw) =>
      NUMBER_PATTERN.test(kw) ||
      PRICE_PATTERN.test(kw) ||
      TIME_PATTERN.test(kw) ||
      PHONE_PATTERN.test(kw) ||
      PROPER_NOUN_PATTERN.test(kw)
    );

    if (hasSpecificContent) {
      // Answer has numbers, prices, names — exact match matters a lot
      return { exact: 0.8, semantic: 0.2 };
    }

    // Only generic keywords like "yes", "available", "no"
    return { exact: 0.3, semantic: 0.7 };
  }
}
