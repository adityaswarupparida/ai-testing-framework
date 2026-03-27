import type { ConversationTurn, GroundTruth } from "./core";

export interface AnalysisResult {
  strategy: "exact" | "semantic" | "composite";
  score: number;
  groundTruth?: string;
  isHumanNeed: boolean;
  roundNumber?: number;
}

export interface AnalysisStrategy {
  analyze(response: string, expected: string, groundTruth?: GroundTruth): Promise<AnalysisResult>;
}

export interface ResponseAnalyzer {
  analyzeAll(
    turns: ConversationTurn[],
    groundTruths: GroundTruth[]
  ): Promise<AnalysisResult[]>;
}
