import type { ConversationTurn } from "./core";
import type { AnalysisResult } from "./analyzer";

export interface ScenarioReport {
  scenarioId: string;
  scenarioName: string;
  turns: ConversationTurn[];
  analysisResults: AnalysisResult[];
  aggregate: number;
  status: "passed" | "failed";
}

export interface TestReport {
  runId: string;
  runName: string;
  modelUnderTest: string;
  scenarios: ScenarioReport[];
  summary: TestSummary;
  startedAt: Date;
  completedAt: Date;
}

export interface TestSummary {
  totalScenarios: number;
  totalTurns: number;
  averageScore: number;
  status: "passed" | "failed";
}

export interface Reporter {
  report(testReport: TestReport): Promise<void>;
}
