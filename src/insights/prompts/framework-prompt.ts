import type { ScenarioReport } from "../../types/report";
import type { Issue } from "../../types/insights";

export function buildFrameworkPrompt(scenario: ScenarioReport, ruleIssues: Issue[]): string {
  const analysisText = scenario.analysisResults
    .map((r) => `[Round ${r.roundNumber}] strategy: ${r.strategy} | score: ${r.score.toFixed(2)}${r.groundTruth ? ` | ground truth: "${r.groundTruth}"` : ""}${r.isHumanNeed ? " [NEEDS HUMAN REVIEW]" : ""}`)
    .join("\n");

  const followUpQuestions = scenario.turns
    .filter((t) => t.type === "follow_up")
    .map((t) => `[Round ${t.roundNumber}] "${t.question}"`)
    .join("\n");

  const ruleIssuesText = ruleIssues.length > 0
    ? ruleIssues.map((i) => `- [${i.priority.toUpperCase()}] ${i.title}: ${i.description}`).join("\n")
    : "None detected by rules.";

  return `You are an expert in AI testing framework quality. You are reviewing a test scenario to assess whether the testing setup itself is working correctly.

Focus on: ground truth completeness, scenario design quality, questionnaire agent behavior, scoring signal reliability.
Do NOT flag issues with the model being tested — that is a separate report.

## Scenario: ${scenario.scenarioName}
Aggregate score: ${scenario.aggregate.toFixed(2)} | Status: ${scenario.status}

## Analysis Results
${analysisText}

## Follow-up Questions Generated
${followUpQuestions}

## Issues Already Detected by Rules
${ruleIssuesText}

## Your Task
1. Identify gaps in ground truth coverage — what topics are users asking about that have no expected answer?
2. Assess whether the follow-up questions are well-formed and answerable
3. Flag any scoring anomalies — e.g. high semantic score but low exact score (may indicate ground truth is too strict)
4. Identify if the scenario is testing the right things or missing important coverage areas
5. Assess severity: critical / high / medium / low

Respond with ONLY valid JSON:
{
  "issues": [
    {
      "priority": "critical|high|medium|low",
      "category": "<short category label>",
      "title": "<concise issue title>",
      "description": "<what is wrong with the test setup>",
      "evidence": [{ "roundNumber": <number>, "detail": "<specific observation>" }],
      "suggestedFix": "<actionable recommendation for the scenario/framework author>"
    }
  ]
}

If no additional issues found beyond what rules detected, return: { "issues": [] }`;
}
