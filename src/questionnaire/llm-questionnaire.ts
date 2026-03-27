import type { ConversationTurn } from "../types";
import type { QuestionnaireAgent } from "../types/questionnaire";
import type { LlmProvider } from "../adapters/llm/provider";

const DEFAULT_PERSONA = `You are a patient interacting with a medical clinic's AI receptionist.
You are testing the receptionist by asking follow-up questions based on the conversation so far.

Your follow-up questions should:
- Be natural and realistic for a patient
- Build on previous answers (e.g., if told a medicine is available, ask about dosage or price)
- Test the receptionist's knowledge depth and consistency
- Sometimes ask for clarification or more details
- Stay within the medical clinic context

Respond with ONLY the next question — no explanation, no quotes, just the question text.`;

export class LlmQuestionnaireAgent implements QuestionnaireAgent {
  private llm: LlmProvider;
  private personaPrompt: string;

  constructor(llm: LlmProvider, personaPrompt?: string) {
    this.llm = llm;
    this.personaPrompt = personaPrompt || DEFAULT_PERSONA;
  }

  async generateFollowUp(
    conversation: ConversationTurn[],
    scenarioContext: string
  ): Promise<string> {
    const conversationLog = conversation
      .map((t) => `Patient: ${t.question}\nReceptionist: ${t.response}`)
      .join("\n\n");

    const userPrompt = `## Scenario Context
${scenarioContext}

## Conversation So Far
${conversationLog}

Based on this conversation, generate the next follow-up question as the patient.`;

    const response = await this.llm.complete([
      { role: "system", content: this.personaPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.7 });

    return response.content.trim();
  }
}
