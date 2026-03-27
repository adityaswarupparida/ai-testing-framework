export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse>;
  readonly providerName: string;
  readonly modelName: string;
}
