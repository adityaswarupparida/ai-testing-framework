import { prisma } from "../../db/client";
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from "./provider";

export class TrackedLlmProvider implements LlmProvider {
  private inner: LlmProvider;
  private caller: string;
  private testRunId: string | null = null;

  get providerName() {
    return this.inner.providerName;
  }
  get modelName() {
    return this.inner.modelName;
  }

  constructor(inner: LlmProvider, caller: "judge" | "questionnaire" | "semantic_analyzer") {
    this.inner = inner;
    this.caller = caller;
  }

  setTestRunId(testRunId: string): void {
    this.testRunId = testRunId;
  }

  async complete(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse> {
    const start = performance.now();
    const response = await this.inner.complete(messages, options);
    const latencyMs = Math.round(performance.now() - start);

    if (this.testRunId) {
      await prisma.llmCall.create({
        data: {
          testRunId: this.testRunId,
          caller: this.caller,
          provider: this.inner.providerName,
          model: this.inner.modelName,
          inputMessages: messages as any,
          outputContent: response.content,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs,
        },
      });
    }

    return response;
  }
}
