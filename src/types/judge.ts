import type { ConversationTurn, GroundTruth, JudgeVerdict } from "./core";

export interface Judge {
  evaluate(
    turn: ConversationTurn,
    fullConversation: ConversationTurn[],
    groundTruth?: GroundTruth
  ): Promise<JudgeVerdict>;
}
