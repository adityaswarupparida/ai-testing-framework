import type { ConversationTurn } from "./core";

export interface QuestionnaireAgent {
  generateFollowUp(
    conversation: ConversationTurn[],
    scenarioContext: string
  ): Promise<string>;
}
