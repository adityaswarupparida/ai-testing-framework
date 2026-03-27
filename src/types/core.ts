export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

export interface ConversationTurn {
  roundNumber: number;
  type: "seed" | "follow_up";
  question: string;
  response: string;
  judgeVerdict?: JudgeVerdict;
  latencyMs?: number;
}

export interface TestScenario {
  id: string;
  name: string;
  seedQuestions: SeedQuestion[];
  maxFollowUpRounds: number;
  context: string;
}

export interface SeedQuestion {
  id: string;
  question: string;
  groundTruth: GroundTruth;
}

export interface GroundTruth {
  expectedAnswer: string;
  requiredKeywords?: string[];
  acceptableVariations?: string[];
}

export interface JudgeVerdict {
  completenessScore: number;  // did it address everything asked?
  coherenceScore: number;     // is it consistent with the conversation?
  totalScore: number;         // average of completeness + coherence
  passed: boolean;
  reasoning: string;
  rawLlmResponse?: string;
}
