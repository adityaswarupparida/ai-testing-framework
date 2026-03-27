import type { Message } from "../../types";
import type { ModelAdapter } from "../../types/model-adapter";

export class HttpModelAdapter implements ModelAdapter {
  readonly name: string;
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(name: string, baseUrl: string) {
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async send(conversationHistory: Message[]): Promise<Message> {
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (!lastMessage) {
      throw new Error("Cannot send empty conversation history");
    }

    const body: Record<string, string> = {
      message: lastMessage.content,
    };
    if (this.sessionId) {
      body.sessionId = this.sessionId;
    }

    const res = await fetch(`${this.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Model HTTP error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as Record<string, any>;

    if (data.sessionId) {
      this.sessionId = data.sessionId;
    }

    const content =
      data.reply ?? data.response ?? data.message ?? data.content ?? JSON.stringify(data);

    return {
      role: "assistant",
      content: String(content),
      timestamp: new Date(),
    };
  }

  async reset(): Promise<void> {
    if (this.sessionId) {
      try {
        await fetch(`${this.baseUrl}/chat/${this.sessionId}`, {
          method: "DELETE",
        });
      } catch {
        // Ignore — session may already be expired
      }
    }
    this.sessionId = null;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
