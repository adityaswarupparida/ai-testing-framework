import type { ConversationTurn, GroundTruth, JudgeVerdict } from "../types";
import type { Judge } from "../types/judge";
import type { LlmProvider } from "../adapters/llm/provider";

const JUDGE_SYSTEM_PROMPT = `You are an expert AI response evaluator.

Your job is to evaluate an AI assistant's response on two universal dimensions:

1. **completeness** (0.0-1.0) — Did the response fully address everything the user asked?
   - 1.0 = answered every part of the question thoroughly
   - 0.5 = answered partially, missed some aspects
   - 0.0 = did not address the question at all

2. **coherence** (0.0-1.0) — Is the response logically consistent and contextually appropriate given the conversation history?
   - 1.0 = perfectly consistent, flows naturally from the conversation
   - 0.5 = mostly consistent but has minor contradictions or context gaps
   - 0.0 = contradicts earlier statements or is completely out of context

Note: Factual correctness is evaluated separately by the analysis system. Focus only on completeness and coherence.

Respond with ONLY valid JSON:
{
  "completenessScore": <number 0.0-1.0>,
  "coherenceScore": <number 0.0-1.0>,
  "reasoning": "<brief explanation of both scores>"
}`;

export class LlmJudge implements Judge {
  private llm: LlmProvider;
  private passThreshold: number;

  constructor(llm: LlmProvider, passThreshold: number = 0.6) {
    this.llm = llm;
    this.passThreshold = passThreshold;
  }

  async evaluate(
    turn: ConversationTurn,
    fullConversation: ConversationTurn[],
    groundTruth?: GroundTruth
  ): Promise<JudgeVerdict> {
    const conversationContext = fullConversation
      .slice(0, -1) // exclude current turn
      .map((t) => `[Round ${t.roundNumber}] User: ${t.question}\nAssistant: ${t.response}`)
      .join("\n\n");

    let userPrompt = `## Turn to Evaluate
**User:** ${turn.question}
**Assistant:** ${turn.response}`;

    if (groundTruth) {
      userPrompt += `\n\n## Expected Answer (for completeness reference)
${groundTruth.expectedAnswer}`;
    }

    if (conversationContext) {
      userPrompt += `\n\n## Conversation History (for coherence check)
${conversationContext}`;
    }

    const response = await this.llm.complete([
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { temperature: 0.1 });

    return this.parseVerdict(response.content, this.passThreshold);
  }

  private parseVerdict(raw: string, passThreshold: number): JudgeVerdict {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in judge response");

      const parsed = JSON.parse(jsonMatch[0]);
      const completenessScore = Math.max(0, Math.min(1, Number(parsed.completenessScore) || 0));
      const coherenceScore = Math.max(0, Math.min(1, Number(parsed.coherenceScore) || 0));
      const totalScore = (completenessScore + coherenceScore) / 2;

      return {
        completenessScore,
        coherenceScore,
        totalScore,
        passed: totalScore >= passThreshold,
        reasoning: parsed.reasoning || "No reasoning provided",
        rawLlmResponse: raw,
      };
    } catch (error) {
      return {
        completenessScore: 0,
        coherenceScore: 0,
        totalScore: 0,
        passed: false,
        reasoning: `Failed to parse judge response: ${error}`,
        rawLlmResponse: raw,
      };
    }
  }
}
