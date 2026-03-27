import type { Message } from "../../types";
import type { ModelAdapter } from "../../types/model-adapter";

export type ModelFunction = (
  conversationHistory: Message[],
  systemPrompt?: string
) => Promise<string>;

export class FunctionModelAdapter implements ModelAdapter {
  readonly name: string;
  private fn: ModelFunction;
  private resetFn?: () => Promise<void>;

  constructor(
    name: string,
    fn: ModelFunction,
    resetFn?: () => Promise<void>
  ) {
    this.name = name;
    this.fn = fn;
    this.resetFn = resetFn;
  }

  async send(conversationHistory: Message[], systemPrompt?: string): Promise<Message> {
    const content = await this.fn(conversationHistory, systemPrompt);
    return {
      role: "assistant",
      content,
      timestamp: new Date(),
    };
  }

  async reset(): Promise<void> {
    if (this.resetFn) await this.resetFn();
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
