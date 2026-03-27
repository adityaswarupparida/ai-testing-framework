import type { ConversationTurn, GroundTruth, JudgeVerdict } from "../types";
import type { Judge } from "../types/judge";
import type { LlmProvider } from "../adapters/llm/provider";

const JUDGE_SYSTEM_PROMPT = `You are an expert AI response evaluator for a Medical Clinic Receptionist AI.

Your job is to evaluate the AI receptionist's response to a patient's question.

Score the response on two dimensions (0.0 to 1.0 each):

1. **accuracy** — Is the response factually correct? Does it match the expected answer (if provided)?
   - 1.0 = perfectly accurate
   - 0.5 = partially accurate, some correct information
   - 0.0 = completely wrong or misleading

2. **relevance** — Is the response relevant to the question asked? Does it address what the patient needs?
   - 1.0 = directly addresses the question
   - 0.5 = somewhat relevant but misses key points
   - 0.0 = completely off-topic

You MUST respond with ONLY valid JSON in this exact format:
{
  "accuracyScore": <number 0.0-1.0>,
  "relevanceScore": <number 0.0-1.0>,
  "reasoning": "<brief explanation of your scores>"
}`;

export class LlmJudge implements Judge {
  private llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async evaluate(
    turn: ConversationTurn,
    fullConversation: ConversationTurn[],
    groundTruth?: GroundTruth
  ): Promise<JudgeVerdict> {
    const conversationContext = fullConversation
      .map((t) => `[Round ${t.roundNumber}] Patient: ${t.question}\nReceptionist: ${t.response}`)
      .join("\n\n");

    let userPrompt = `## Current Turn to Evaluate
**Patient Question:** ${turn.question}
**Receptionist Response:** ${turn.response}`;

    if (groundTruth) {
      userPrompt += `\n\n## Ground Truth
**Expected Answer:** ${groundTruth.expectedAnswer}`;
      if (groundTruth.requiredKeywords?.length) {
        userPrompt += `\n**Required Keywords:** ${groundTruth.requiredKeywords.join(", ")}`;
      }
      if (groundTruth.acceptableVariations?.length) {
        userPrompt += `\n**Acceptable Variations:** ${groundTruth.acceptableVariations.join(", ")}`;
      }
    }

    if (fullConversation.length > 1) {
      userPrompt += `\n\n## Full Conversation Context\n${conversationContext}`;
    }

    const response = await this.llm.complete([
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { temperature: 0.1 });

    return this.parseVerdict(response.content);
  }

  private parseVerdict(raw: string): JudgeVerdict {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in judge response");

      const parsed = JSON.parse(jsonMatch[0]);
      const accuracyScore = Math.max(0, Math.min(1, Number(parsed.accuracyScore) || 0));
      const relevanceScore = Math.max(0, Math.min(1, Number(parsed.relevanceScore) || 0));

      return {
        accuracyScore,
        relevanceScore,
        totalScore: (accuracyScore + relevanceScore) / 2,
        reasoning: parsed.reasoning || "No reasoning provided",
        rawResponse: raw,
      };
    } catch (error) {
      return {
        accuracyScore: 0,
        relevanceScore: 0,
        totalScore: 0,
        reasoning: `Failed to parse judge response: ${error}`,
        rawResponse: raw,
      };
    }
  }
}
