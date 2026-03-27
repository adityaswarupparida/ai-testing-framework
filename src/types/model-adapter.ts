import type { Message } from "./core";

export interface ModelAdapter {
  send(conversationHistory: Message[], systemPrompt?: string): Promise<Message>;
  reset?(): Promise<void>;
  healthCheck?(): Promise<boolean>;
  readonly name: string;
}
