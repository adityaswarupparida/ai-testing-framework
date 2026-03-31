import type { ScenarioReport } from "../../types/report";
import type { Issue } from "../../types/insights";

export function runFrameworkRules(scenario: ScenarioReport): Issue[] {
  const issues: Issue[] = [];

  // 1. Follow-up turns with no semantic score — ground truth gap
  const followUpTurns = scenario.turns.filter((t) => t.type === "follow_up");
  const roundsWithSemantic = new Set(
    scenario.analysisResults
      .filter((r) => r.strategy === "semantic" && r.roundNumber !== undefined)
      .map((r) => r.roundNumber)
  );
  const missingGroundTruth = followUpTurns.filter(
    (t) => !roundsWithSemantic.has(t.roundNumber)
  );
  if (missingGroundTruth.length > 0) {
    issues.push({
      priority: "high",
      category: "ground_truth_gap",
      title: "Follow-up topics not covered by ground truth",
      description: `${missingGroundTruth.length} follow-up turn(s) where the question went beyond the seed's expected answer scope — no semantic scoring was possible.`,
      evidence: missingGroundTruth.map((t) => ({
        roundNumber: t.roundNumber,
        detail: `question: "${t.question.slice(0, 80)}"`,
      })),
      suggestedFix: "Add seed questions (with ground truth) that cover these topics, or extend existing ground truth to include them.",
    });
  }

  // 2. All seed turns passing with perfect scores — scenario may be too easy
  const seedTurns = scenario.turns.filter((t) => t.type === "seed");
  const allSeedsPerfect = seedTurns.every(
    (t) => t.judgeVerdict && t.judgeVerdict.totalScore === 1.0
  );
  const allCompositeHigh = scenario.analysisResults
    .filter((r) => r.strategy === "composite")
    .every((r) => r.score >= 0.9);
  if (allSeedsPerfect && allCompositeHigh && seedTurns.length > 0) {
    issues.push({
      priority: "low",
      category: "scenario_quality",
      title: "Scenario may be too easy — all seeds passed perfectly",
      description: "Every seed question scored 1.0 on judge and ≥0.9 on composite. Consider adding harder or more adversarial seed questions.",
      evidence: [],
      suggestedFix: "Add edge cases, ambiguous questions, or questions that require the model to handle conflicting information.",
    });
  }

  // 3. Exact score consistently 0.85 (default) — requiredKeywords may be too generic
  const exactScores = scenario.analysisResults
    .filter((r) => r.strategy === "exact")
    .map((r) => r.score);
  const allDefault = exactScores.length > 0 && exactScores.every((s) => s === 0.85);
  if (allDefault) {
    issues.push({
      priority: "low",
      category: "scenario_quality",
      title: "Exact scores all defaulting to 0.85",
      description: "All exact match scores are 0.85 — this suggests requiredKeywords may not be strict enough or are matching too easily.",
      evidence: [],
      suggestedFix: "Review requiredKeywords in your scenario files — make them more specific to better differentiate correct from incorrect responses.",
    });
  }

  // 4. High ratio of follow-up failures vs seed failures
  const seedFailures = seedTurns.filter(
    (t) => t.judgeVerdict && !t.judgeVerdict.passed
  ).length;
  const followUpFailures = followUpTurns.filter(
    (t) => t.judgeVerdict && !t.judgeVerdict.passed
  ).length;
  if (followUpFailures > seedFailures * 2 && followUpFailures >= 2) {
    issues.push({
      priority: "medium",
      category: "questionnaire_quality",
      title: "Follow-up questions generating disproportionate failures",
      description: `${followUpFailures} follow-up failure(s) vs ${seedFailures} seed failure(s). The questionnaire agent may be generating questions that are too complex or unanswerable.`,
      evidence: followUpTurns
        .filter((t) => t.judgeVerdict && !t.judgeVerdict.passed)
        .map((t) => ({
          roundNumber: t.roundNumber,
          detail: `question: "${t.question.slice(0, 80)}"`,
        })),
      suggestedFix: "Review the questionnaire persona prompt — ensure it generates questions the model can reasonably answer given its knowledge scope.",
    });
  }

  return issues;
}
