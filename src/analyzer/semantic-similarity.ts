import type { AnalysisResult, AnalysisStrategy } from "../types/analyzer";
import type { LlmProvider } from "../adapters/llm/provider";

const SEMANTIC_PROMPT = `You are a semantic similarity evaluator. Compare the AI response against the expected answer and determine how semantically similar they are.

Consider:
- Do they convey the same meaning, even if worded differently?
- Does the response contain the key information from the expected answer?
- Is the intent and factual content preserved?

Respond with ONLY valid JSON:
{
  "score": <number 0.0-1.0>,
  "reasoning": "<brief explanation>"
}

Where:
- 1.0 = semantically identical / conveys exact same meaning
- 0.7-0.9 = mostly the same meaning with minor differences
- 0.4-0.6 = partially similar, some key info matches
- 0.1-0.3 = vaguely related but mostly different
- 0.0 = completely different meaning`;

export class SemanticSimilarityAnalyzer implements AnalysisStrategy {
  private llm: LlmProvider;

  constructor(llm: LlmProvider) {
    this.llm = llm;
  }

  async analyze(response: string, expected: string): Promise<AnalysisResult> {
    const userPrompt = `**AI Response:** ${response}\n\n**Expected Answer:** ${expected}`;

    const llmResponse = await this.llm.complete([
      { role: "system", content: SEMANTIC_PROMPT },
      { role: "user", content: userPrompt },
    ], { temperature: 0.1 });

    return this.parseResult(llmResponse.content, expected);
  }

  private parseResult(raw: string, expected: string): AnalysisResult {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in semantic response");

      const parsed = JSON.parse(jsonMatch[0]);
      const score = Math.max(0, Math.min(1, Number(parsed.score) || 0));

      return {
        strategy: "semantic",
        score,
        groundTruth: expected,
        isHumanNeed: score < 0.4,
      };
    } catch {
      return {
        strategy: "semantic",
        score: 0,
        groundTruth: expected,
        isHumanNeed: true,
      };
    }
  }
}
