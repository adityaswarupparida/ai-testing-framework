import type { GroundTruth } from "../types";
import type { AnalysisResult, AnalysisStrategy } from "../types/analyzer";
import type { EmbeddingGenerator } from "./embedding-generator";

export class SemanticSimilarityAnalyzer implements AnalysisStrategy {
  private embedder: EmbeddingGenerator;

  constructor(embedder: EmbeddingGenerator) {
    this.embedder = embedder;
  }

  async analyze(response: string, expected: string, groundTruth?: GroundTruth): Promise<AnalysisResult> {
    const [responseVec, expectedVec] = await Promise.all([
      this.embedder.embed(response, "semantic_analyzer"),
      this.embedder.embed(expected, "semantic_analyzer"),
    ]);
    return this.analyzeWithVectors(responseVec, expectedVec, expected);
  }

  analyzeWithVectors(responseVec: number[], expectedVec: number[], expected?: string): AnalysisResult {
    const score = this.embedder.cosineSimilarity(responseVec, expectedVec);
    return {
      strategy: "semantic",
      score: Math.max(0, Math.min(1, score)),
      groundTruth: expected,
      isHumanNeed: score < 0.4,
    };
  }
}
