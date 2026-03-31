import type { ScenarioReport } from "../../types/report";
import type { Issue } from "../../types/insights";

export function buildModelOwnerPrompt(scenario: ScenarioReport, ruleIssues: Issue[]): string {
  const turnsText = scenario.turns
    .map((t) => {
      const verdict = t.judgeVerdict
        ? `judge: ${t.judgeVerdict.totalScore.toFixed(2)} (completeness: ${t.judgeVerdict.completenessScore}, coherence: ${t.judgeVerdict.coherenceScore}) — ${t.judgeVerdict.reasoning}`
        : "no verdict";
      return `[Round ${t.roundNumber}] (${t.type})\nQ: ${t.question}\nA: ${t.response}\n${verdict}`;
    })
    .join("\n\n");

  const ruleIssuesText = ruleIssues.length > 0
    ? ruleIssues.map((i) => `- [${i.priority.toUpperCase()}] ${i.title}: ${i.description}`).join("\n")
    : "None detected by rules.";

  return `You are an expert AI quality analyst reviewing a test run of an AI assistant.

Your job is to identify issues with the MODEL's behavior and suggest fixes for the model owner.
Focus on: response quality, consistency, factual accuracy, handling of multi-part questions, conversation coherence.
Do NOT flag issues with the test setup or scenario design — that is a separate report.

## Scenario: ${scenario.scenarioName}

## Conversation Turns
${turnsText}

## Issues Already Detected by Rules
${ruleIssuesText}

## Your Task
1. Identify any additional issues not already caught by the rules above
2. Look for patterns across multiple turns (e.g. model always deflects certain question types)
3. Assess severity: critical (breaks core functionality) / high (significantly degrades experience) / medium (noticeable but not blocking) / low (minor)
4. Suggest specific, actionable fixes for each issue

Respond with ONLY valid JSON:
{
  "issues": [
    {
      "priority": "critical|high|medium|low",
      "category": "<short category label>",
      "title": "<concise issue title>",
      "description": "<what is wrong and why it matters>",
      "evidence": [{ "roundNumber": <number>, "detail": "<what specifically happened>" }],
      "suggestedFix": "<actionable recommendation for the model owner>"
    }
  ]
}

If no additional issues found beyond what rules detected, return: { "issues": [] }`;
}
