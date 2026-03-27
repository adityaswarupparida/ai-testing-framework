import { prisma } from "../db/client";
import type { TestScenario } from "../types";
import type { EmbeddingGenerator } from "../analyzer/embedding-generator";

export interface FrameworkConfig {
  sut: {
    adapterType: "http" | "function";
    name: string;
    baseUrl?: string;
  };
  llm: {
    provider: "gemini";
    model: string;
    temperature?: number;
  };
  judge: {
    passThreshold: number;
  };
  questionnaire: {
    maxFollowUpRounds: number;
    personaPrompt: string;
  };
  analyzer: {
    weights: {
      exact: number;
      semantic: number;
    };
  };
  execution: {
    delayBetweenCallsMs?: number;
  };
  reporting: {
    outputFormats: ("json" | "console")[];
    outputDir: string;
  };
}

export async function loadConfig(configPath: string): Promise<FrameworkConfig> {
  const file = Bun.file(configPath);
  const config = (await file.json()) as FrameworkConfig;
  validateConfig(config);
  return config;
}

export async function loadScenario(scenarioPath: string): Promise<TestScenario> {
  const file = Bun.file(scenarioPath);
  const scenario = (await file.json()) as TestScenario;
  validateScenario(scenario);
  return scenario;
}

export async function loadScenarios(scenarioPaths: string[]): Promise<TestScenario[]> {
  return Promise.all(scenarioPaths.map(loadScenario));
}

export interface ScenarioDbMap {
  scenarioDbId: string;
  seedQuestionDbIds: Record<string, string>; // JSON questionId → DB SeedQuestion.id
}

/**
 * Upserts Scenario + SeedQuestion rows into DB.
 * Computes expectedEmbedding for each SeedQuestion only if not already stored.
 * Returns DB ids needed for ScenarioRun and Conversation FK references.
 */
export async function upsertScenario(
  scenario: TestScenario,
  embedder: EmbeddingGenerator
): Promise<ScenarioDbMap> {
  const dbScenario = await prisma.scenario.upsert({
    where: { scenarioId: scenario.id },
    create: {
      scenarioId: scenario.id,
      name: scenario.name,
      context: scenario.context,
      maxFollowUpRounds: scenario.maxFollowUpRounds,
    },
    update: {
      name: scenario.name,
      context: scenario.context,
      maxFollowUpRounds: scenario.maxFollowUpRounds,
    },
  });

  // 1 query: load all existing seed questions for this scenario
  // Use raw SQL to also check expectedEmbedding (Unsupported type, not selectable via Prisma client)
  const existingQuestions = await prisma.$queryRaw<
    { id: string; questionId: string; hasEmbedding: boolean }[]
  >`
    SELECT id, "questionId", "expectedEmbedding" IS NOT NULL AS "hasEmbedding"
    FROM "SeedQuestion"
    WHERE "scenarioId" = ${dbScenario.id}
  `;
  const existingMap = new Map(
    existingQuestions.map((q) => [q.questionId, { id: q.id, expectedEmbedding: q.hasEmbedding }])
  );

  // Classify questions and embed in parallel (only those that need it)
  type ToInsert = { q: (typeof scenario.seedQuestions)[number]; embedding: number[] };
  type ToUpdate = { id: string; embedding: number[] };

  const insertItems: ToInsert[] = [];
  const updateItems: ToUpdate[] = [];

  await Promise.all(
    scenario.seedQuestions.map(async (q) => {
      const existing = existingMap.get(q.id);
      if (!existing) {
        const embedding = await embedder.embed(q.groundTruth.expectedAnswer, "embedding");
        insertItems.push({ q, embedding });
      } else if (!existing.expectedEmbedding) {
        const embedding = await embedder.embed(q.groundTruth.expectedAnswer, "embedding");
        updateItems.push({ id: existing.id, embedding });
      }
    })
  );

  // Write inserts and updates concurrently
  await Promise.all([
    ...insertItems.map(({ q, embedding }) =>
      prisma.$executeRaw`
        INSERT INTO "SeedQuestion" (
          id, "scenarioId", "questionId", question, "expectedAnswer",
          "requiredKeywords", "acceptableVariations", "expectedEmbedding",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(),
          ${dbScenario.id},
          ${q.id},
          ${q.question},
          ${q.groundTruth.expectedAnswer},
          ${q.groundTruth.requiredKeywords ?? []},
          ${q.groundTruth.acceptableVariations ?? []},
          ${`[${embedding.join(",")}]`}::vector,
          NOW(), NOW()
        )
      `
    ),
    ...updateItems.map(({ id, embedding }) =>
      prisma.$executeRaw`
        UPDATE "SeedQuestion"
        SET "expectedEmbedding" = ${`[${embedding.join(",")}]`}::vector,
            "updatedAt" = NOW()
        WHERE id = ${id}
      `
    ),
  ]);

  // Collect DB ids — re-use existingMap for unchanged, add newly inserted ones
  const seedQuestionDbIds: Record<string, string> = {};
  for (const [qId, sq] of existingMap) {
    seedQuestionDbIds[qId] = sq.id;
  }
  if (insertItems.length > 0) {
    // Fetch only the newly inserted rows
    const inserted = await prisma.seedQuestion.findMany({
      where: {
        scenarioId: dbScenario.id,
        questionId: { in: insertItems.map(({ q }) => q.id) },
      },
      select: { id: true, questionId: true },
    });
    for (const sq of inserted) {
      seedQuestionDbIds[sq.questionId] = sq.id;
    }
  }

  return { scenarioDbId: dbScenario.id, seedQuestionDbIds };
}

function validateConfig(config: FrameworkConfig): void {
  if (!config.sut) throw new Error("Config missing 'sut' (system under test)");
  if (!config.sut.adapterType) throw new Error("Config missing 'sut.adapterType'");
  if (config.sut.adapterType === "http" && !config.sut.baseUrl) {
    throw new Error("HTTP adapter requires 'sut.baseUrl'");
  }
  if (!config.llm) throw new Error("Config missing 'llm'");
  if (!config.llm.model) throw new Error("Config missing 'llm.model'");
  if (!config.judge?.passThreshold) throw new Error("Config missing 'judge.passThreshold'");
}

function validateScenario(scenario: TestScenario): void {
  if (!scenario.id) throw new Error("Scenario missing 'id'");
  if (!scenario.name) throw new Error("Scenario missing 'name'");
  if (!scenario.seedQuestions?.length) {
    throw new Error(`Scenario '${scenario.id}' has no seed questions`);
  }
  for (const q of scenario.seedQuestions) {
    if (!q.id || !q.question) {
      throw new Error(`Scenario '${scenario.id}' has invalid seed question`);
    }
    if (!q.groundTruth?.expectedAnswer) {
      throw new Error(`Seed question '${q.id}' missing ground truth expected answer`);
    }
  }
}
