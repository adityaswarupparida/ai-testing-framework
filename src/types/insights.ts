export type Priority = "critical" | "high" | "medium" | "low";

export interface Issue {
  priority: Priority;
  category: string;
  title: string;
  description: string;
  evidence: { roundNumber: number; detail: string }[];
  suggestedFix?: string;
}

export interface ScenarioInsights {
  scenarioId: string;
  scenarioName: string;
  modelOwnerIssues: Issue[];
  frameworkIssues: Issue[];
}

export interface InsightsReport {
  runId: string;
  runName: string;
  modelUnderTest: string;
  generatedAt: string;
  scenarios: ScenarioInsights[];
  summary: {
    totalIssues: number;
    byPriority: Record<Priority, number>;
  };
}
