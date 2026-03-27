import { GoogleGenAI } from "@google/genai";
import { prisma } from "../db/client";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 3072;

export class EmbeddingGenerator {
  private client: GoogleGenAI;
  private testRunId: string | null = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is required");
    this.client = new GoogleGenAI({ apiKey });
  }

  setTestRunId(testRunId: string): void {
    this.testRunId = testRunId;
  }

  async embed(text: string, caller: string): Promise<number[]> {
    const start = performance.now();

    const response = await this.client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    const latencyMs = Math.round(performance.now() - start);
    const values = response.embeddings?.[0]?.values ?? [];

    if (this.testRunId) {
      await prisma.llmCall.create({
        data: {
          testRunId: this.testRunId,
          caller,
          provider: "gemini",
          model: EMBEDDING_MODEL,
          inputMessages: { text },
          outputContent: `vector(${values.length})`,
          latencyMs,
        },
      });
    }

    return values;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
