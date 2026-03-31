import type { ScenarioReport } from "../../types/report";
import type { Issue } from "../../types/insights";

const LATENCY_THRESHOLD_MS = 5000;

export function runModelRules(scenario: ScenarioReport): Issue[] {
  const issues: Issue[] = [];

  // 1. Multi-part question failures — judge completeness <= 0.5
  const multiPartFailures = scenario.turns.filter(
    (t) => t.judgeVerdict && t.judgeVerdict.completenessScore <= 0.5
  );
  if (multiPartFailures.length > 0) {
    issues.push({
      priority: multiPartFailures.length >= 3 ? "critical" : "high",
      category: "completeness",
      title: "Model skips parts of multi-part questions",
      description: `${multiPartFailures.length} turn(s) where the model silently ignored one or more parts of a compound question.`,
      evidence: multiPartFailures.map((t) => ({
        roundNumber: t.roundNumber,
        detail: `completeness: ${t.judgeVerdict!.completenessScore} — ${t.judgeVerdict!.reasoning}`,
      })),
      suggestedFix: "Review model prompt — ensure it is instructed to address every part of a multi-part question before responding.",
    });
  }

  // 2. Coherence failures — contradictions or context loss
  const coherenceFailures = scenario.turns.filter(
    (t) => t.judgeVerdict && t.judgeVerdict.coherenceScore <= 0.25
  );
  if (coherenceFailures.length > 0) {
    issues.push({
      priority: "critical",
      category: "coherence",
      title: "Model contradicts earlier statements or loses context",
      description: `${coherenceFailures.length} turn(s) where the model contradicted something established earlier or hallucinated context.`,
      evidence: coherenceFailures.map((t) => ({
        roundNumber: t.roundNumber,
        detail: `coherence: ${t.judgeVerdict!.coherenceScore} — ${t.judgeVerdict!.reasoning}`,
      })),
      suggestedFix: "Check if the model is receiving the full conversation history. Hallucinated context often indicates a context window or memory issue.",
    });
  }

  // 3. Factual hallucinations — exact score 0 on seed turns
  const exactFailures = scenario.analysisResults.filter(
    (r) => r.strategy === "exact" && r.score === 0
  );
  if (exactFailures.length > 0) {
    issues.push({
      priority: "critical",
      category: "factual_accuracy",
      title: "Model gave factually incorrect answers",
      description: `${exactFailures.length} seed turn(s) where the model's response had zero keyword match against ground truth — likely a hallucination or wrong fact.`,
      evidence: exactFailures.map((r) => ({
        roundNumber: r.roundNumber ?? 0,
        detail: `exact: 0 | ground truth: "${r.groundTruth}"`,
      })),
      suggestedFix: "Verify the model's knowledge base or RAG source. If the model is making up facts, consider grounding it with stricter retrieval constraints.",
    });
  }

  // 4. Low composite scores on seed turns
  const lowComposite = scenario.analysisResults.filter(
    (r) => r.strategy === "composite" && r.score < 0.5
  );
  if (lowComposite.length > 0) {
    issues.push({
      priority: "high",
      category: "factual_accuracy",
      title: "Low factual accuracy on seed questions",
      description: `${lowComposite.length} seed turn(s) with composite score below 0.5 — responses are factually weak compared to ground truth.`,
      evidence: lowComposite.map((r) => ({
        roundNumber: r.roundNumber ?? 0,
        detail: `composite: ${r.score.toFixed(2)} | ground truth: "${r.groundTruth}"`,
      })),
      suggestedFix: "Review what the model knows about these topics. Consider updating its knowledge base or fine-tuning on these question types.",
    });
  }

  // 5. High latency turns
  const highLatency = scenario.turns.filter(
    (t) => t.latencyMs && t.latencyMs > LATENCY_THRESHOLD_MS
  );
  if (highLatency.length > 0) {
    issues.push({
      priority: "medium",
      category: "performance",
      title: "High response latency detected",
      description: `${highLatency.length} turn(s) exceeded ${LATENCY_THRESHOLD_MS}ms response time.`,
      evidence: highLatency.map((t) => ({
        roundNumber: t.roundNumber,
        detail: `latency: ${t.latencyMs}ms`,
      })),
      suggestedFix: "Investigate model inference time. Consider caching, reducing context length, or switching to a faster model variant for high-traffic scenarios.",
    });
  }

  // 6. Turns needing human review
  const humanNeeded = scenario.analysisResults.filter((r) => r.isHumanNeed);
  if (humanNeeded.length > 0) {
    issues.push({
      priority: "medium",
      category: "human_review",
      title: "Turns flagged for human review",
      description: `${humanNeeded.length} analysis result(s) flagged as requiring human review due to low scores.`,
      evidence: humanNeeded.map((r) => ({
        roundNumber: r.roundNumber ?? 0,
        detail: `strategy: ${r.strategy} | score: ${r.score.toFixed(2)}`,
      })),
    });
  }

  return issues;
}
