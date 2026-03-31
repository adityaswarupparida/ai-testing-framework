import type { ConversationTurn, GroundTruth, JudgeVerdict } from "../types";
import type { Judge } from "../types/judge";
import type { LlmProvider } from "../adapters/llm/provider";

const JUDGE_SYSTEM_PROMPT = `You are an expert AI response evaluator.

Your job is to evaluate an AI assistant's response on two universal dimensions.
Each dimension must be scored using ONLY one of these five values: 0.0, 0.25, 0.5, 0.75, 1.0

1. **completeness** — Did the response fully address everything the user asked?
   - 1.0  = answered every part of the question thoroughly
   - 0.75 = acknowledged every part but could not fully answer one part (e.g. stated a limitation and redirected — this counts as addressing the question, not ignoring it)
   - 0.5  = answered one part of a multi-part question and completely ignored another without any acknowledgment
   - 0.25 = touched on the topic but mostly incomplete
   - 0.0  = did not address the question at all
   - Important: If the assistant explicitly acknowledges a part of the question it cannot answer and redirects (e.g. "I don't have that information" or "please contact X for that"), score 0.75 — this counts as addressing the question. Reserve 0.5 or below only when a part is silently skipped with no acknowledgment at all.

2. **coherence** — Is the response logically consistent and contextually appropriate given the conversation history?
   - 1.0  = perfectly consistent, flows naturally, and acknowledges all parts of the user's question
   - 0.75 = mostly consistent but has a minor context gap or slightly awkward flow
   - 0.5  = selectively ignores part of a multi-part question, or has a noticeable contradiction
   - 0.25 = largely inconsistent or mostly ignores the conversation context
   - 0.0  = contradicts earlier statements, is completely out of context, or ignores the question entirely
   - Note: A response that silently skips one part of a multi-part question is NOT fully coherent, even if the answered part is correct.
   - Note: If the response states a fact that directly contradicts something established earlier in the conversation history (e.g. an item was previously said to be out of stock but is now said to be available), that is a coherence failure — score 0.0 or 0.25 depending on severity.

Note: Factual correctness is evaluated separately by the analysis system. Focus only on completeness and coherence.

Respond with ONLY valid JSON:
{
  "completenessScore": <one of: 0.0, 0.25, 0.5, 0.75, 1.0>,
  "coherenceScore": <one of: 0.0, 0.25, 0.5, 0.75, 1.0>,
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

      const VALID_SCORES = [0.0, 0.25, 0.5, 0.75, 1.0];
      const snap = (v: number) => VALID_SCORES.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);

      const parsed = JSON.parse(jsonMatch[0]);
      const completenessScore = snap(Math.max(0, Math.min(1, Number(parsed.completenessScore) || 0)));
      const coherenceScore = snap(Math.max(0, Math.min(1, Number(parsed.coherenceScore) || 0)));
      const totalScore = completenessScore * 0.6 + coherenceScore * 0.4;

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
