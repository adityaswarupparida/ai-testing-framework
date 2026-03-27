import { GoogleGenAI } from "@google/genai";
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from "./provider";

export class GeminiProvider implements LlmProvider {
  private client: GoogleGenAI;
  readonly providerName = "gemini";
  readonly modelName: string;

  constructor(model: string = "gemini-2.0-flash") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required");
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = model;
  }

  async complete(messages: LlmMessage[], options?: LlmOptions): Promise<LlmResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: chatMessages,
      config: {
        systemInstruction: systemMessage?.content,
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
    });

    const text = response.text ?? "";
    return {
      content: text,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    };
  }
}
