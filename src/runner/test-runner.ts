import { prisma } from "../db/client";
import type { ConversationTurn, Message, TestScenario } from "../types";
import type { ModelAdapter } from "../types/model-adapter";
import type { Judge } from "../types/judge";
import type { QuestionnaireAgent } from "../types/questionnaire";
import type { ResponseAnalyzer } from "../types/analyzer";
import type { Reporter, ScenarioReport, TestReport, TestSummary } from "../types/report";
import type { FrameworkConfig } from "../config/loader";
import type { ScenarioDbMap } from "../config/loader";
import type { TrackedLlmProvider } from "../adapters/llm/tracked-provider";
import type { EmbeddingGenerator } from "../analyzer/embedding-generator";

export interface TestRunnerDeps {
  model: ModelAdapter;
  judge: Judge;
  questionnaire: QuestionnaireAgent;
  analyzer: ResponseAnalyzer;
  reporters: Reporter[];
  trackedProviders: TrackedLlmProvider[];
  embedder: EmbeddingGenerator;
}

export class TestRunner {
  private config: FrameworkConfig;
  private deps: TestRunnerDeps;

  constructor(config: FrameworkConfig, deps: TestRunnerDeps) {
    this.config = config;
    this.deps = deps;
  }

  async run(
    scenarios: TestScenario[],
    scenarioDbMaps: Map<string, ScenarioDbMap>,
    runName?: string
  ): Promise<TestReport> {
    const startedAt = new Date();

    // Create test run in DB
    const testRun = await prisma.testRun.create({
      data: {
        runName: runName || `Run ${startedAt.toISOString()}`,
        modelUnderTest: this.deps.model.name,
        config: this.config as any,
        status: "running",
        startedAt,
      },
    });

    // Set test run ID on tracked providers and embedder for LLM call logging
    for (const provider of this.deps.trackedProviders) {
      provider.setTestRunId(testRun.id);
    }
    this.deps.embedder.setTestRunId(testRun.id);

    // Health check
    if (this.deps.model.healthCheck) {
      const healthy = await this.deps.model.healthCheck();
      if (!healthy) {
        await prisma.testRun.update({
          where: { id: testRun.id },
          data: { status: "failed", completedAt: new Date() },
        });
        throw new Error(`Model '${this.deps.model.name}' failed health check`);
      }
    }

    const scenarioReports: ScenarioReport[] = [];

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i]!;
      const dbMap = scenarioDbMaps.get(scenario.id);
      if (!dbMap) throw new Error(`No DB map found for scenario '${scenario.id}'`);

      console.log(`\n[${i + 1}/${scenarios.length}] Scenario: ${scenario.name} (${scenario.seedQuestions.length} seed + ${scenario.maxFollowUpRounds} follow-up rounds)`);
      const report = await this.runScenario(testRun.id, scenario, dbMap);
      scenarioReports.push(report);
      console.log(`  -> ${report.status.toUpperCase()} (score: ${report.aggregate.toFixed(2)})`);

      if (this.config.execution.delayBetweenCallsMs) {
        await Bun.sleep(this.config.execution.delayBetweenCallsMs);
      }
    }

    const completedAt = new Date();
    const summary = this.buildSummary(scenarioReports);

    // Update test run
    await prisma.testRun.update({
      where: { id: testRun.id },
      data: {
        status: summary.status,
        completedAt,
        summary: summary as any,
      },
    });

    const report: TestReport = {
      runId: testRun.id,
      runName: testRun.runName || "",
      modelUnderTest: this.deps.model.name,
      scenarios: scenarioReports,
      summary,
      startedAt,
      completedAt,
    };

    // Run reporters
    for (const reporter of this.deps.reporters) {
      await reporter.report(report);
    }

    return report;
  }

  private async runScenario(
    testRunId: string,
    scenario: TestScenario,
    dbMap: ScenarioDbMap
  ): Promise<ScenarioReport> {
    const scenarioRun = await prisma.scenarioRun.create({
      data: {
        testRunId,
        scenarioId: dbMap.scenarioDbId,
        status: "running",
      },
    });

    const allTurns: ConversationTurn[] = [];
    const allAnalysisResults: import("../types/analyzer").AnalysisResult[] = [];
    const maxRounds = scenario.maxFollowUpRounds || this.config.questionnaire.maxFollowUpRounds;
    const totalSeeds = scenario.seedQuestions.length;
    let roundCounter = 0;

    for (let qi = 0; qi < totalSeeds; qi++) {
      const seedQuestion = scenario.seedQuestions[qi]!;
      const seedTurns: ConversationTurn[] = [];
      const seedHistory: Message[] = [];

      // Resolve DB id for this seed question
      const seedQuestionDbId = dbMap.seedQuestionDbIds[seedQuestion.id];
      if (!seedQuestionDbId) {
        throw new Error(`No DB id found for seed question '${seedQuestion.id}'`);
      }

      // Reset model state for each seed question's conversation
      if (this.deps.model.reset) {
        await this.deps.model.reset();
      }

      // -- Seed question --
      console.log(`\n  [Seed ${qi + 1}/${totalSeeds}] "${seedQuestion.question.slice(0, 60)}"`);
      roundCounter++;
      const { turn: seedTurn, conversationId: seedConvId, responseVec: seedResponseVec } = await this.askQuestion(
        scenarioRun.id,
        seedQuestion.question,
        seedHistory,
        roundCounter,
        "seed",
        seedQuestionDbId
      );

      seedTurn.judgeVerdict = await this.deps.judge.evaluate(
        seedTurn,
        [seedTurn],
        seedQuestion.groundTruth
      );
      await this.saveJudgeVerdict(seedConvId, seedTurn);

      // -- Analysis for this seed's response --
      // Fetch stored expectedEmbedding from DB — avoids re-embedding the expected answer
      const expectedVec = await this.getExpectedEmbedding(seedQuestionDbId);
      const precomputedVectors = expectedVec
        ? { responseVec: seedResponseVec, expectedVec }
        : undefined;
      const seedAnalysis = await this.deps.analyzer.analyzeAll(
        [seedTurn],
        [seedQuestion.groundTruth],
        precomputedVectors
      );
      for (const result of seedAnalysis) {
        result.roundNumber = seedTurn.roundNumber;
        await prisma.analysisResult.create({
          data: {
            conversationId: seedConvId,
            strategy: result.strategy,
            score: result.score,
            groundTruth: result.groundTruth,
            isHumanNeed: result.isHumanNeed,
          },
        });
      }
      const composite = seedAnalysis.find((r) => r.strategy === "composite");
      const humanNeeded = seedAnalysis.some((r) => r.isHumanNeed);
      console.log(`    -> judge: ${seedTurn.judgeVerdict.totalScore.toFixed(2)} | composite: ${composite?.score.toFixed(2) ?? "N/A"}${humanNeeded ? " [NEEDS HUMAN REVIEW]" : ""} (${seedTurn.latencyMs}ms)`);

      seedHistory.push(
        { role: "user", content: seedTurn.question },
        { role: "assistant", content: seedTurn.response }
      );
      seedTurns.push(seedTurn);

      // -- Follow-up rounds for this seed --
      for (let fi = 0; fi < maxRounds; fi++) {
        if (this.config.execution.delayBetweenCallsMs) {
          await Bun.sleep(this.config.execution.delayBetweenCallsMs);
        }

        const followUpQuestion = await this.deps.questionnaire.generateFollowUp(
          seedTurns,
          scenario.context
        );

        roundCounter++;
        const { turn: followTurn, conversationId: followConvId, responseVec: followResponseVec } = await this.askQuestion(
          scenarioRun.id,
          followUpQuestion,
          seedHistory,
          roundCounter,
          "follow_up"
        );

        followTurn.judgeVerdict = await this.deps.judge.evaluate(followTurn, seedTurns.concat(followTurn));
        await this.saveJudgeVerdict(followConvId, followTurn);

        // Semantic analysis for follow-up: reuse expectedVec already fetched for this seed
        const semanticScore = expectedVec
          ? this.deps.embedder.cosineSimilarity(followResponseVec, expectedVec)
          : null;
        if (semanticScore !== null) {
          const followSemanticResult: import("../types/analyzer").AnalysisResult = {
            strategy: "semantic",
            score: Math.max(0, Math.min(1, semanticScore)),
            isHumanNeed: semanticScore < 0.4,
            roundNumber: followTurn.roundNumber,
          };
          allAnalysisResults.push(followSemanticResult);
          await prisma.analysisResult.create({
            data: {
              conversationId: followConvId,
              strategy: followSemanticResult.strategy,
              score: followSemanticResult.score,
              isHumanNeed: followSemanticResult.isHumanNeed,
            },
          });
        }

        const semanticLabel = semanticScore !== null ? ` | semantic: ${semanticScore.toFixed(2)}` : "";
        console.log(`    Follow-up ${fi + 1}/${maxRounds}: "${followUpQuestion.slice(0, 50)}..." -> judge: ${followTurn.judgeVerdict.totalScore.toFixed(2)}${semanticLabel} (${followTurn.latencyMs}ms)`);

        seedHistory.push(
          { role: "user", content: followTurn.question },
          { role: "assistant", content: followTurn.response }
        );
        seedTurns.push(followTurn);
      }

      allTurns.push(...seedTurns);
      allAnalysisResults.push(...seedAnalysis);

      if (this.config.execution.delayBetweenCallsMs) {
        await Bun.sleep(this.config.execution.delayBetweenCallsMs);
      }
    }

    const turns = allTurns;
    const analysisResults = allAnalysisResults;

    // Compute aggregate
    const judgeScores = turns
      .filter((t) => t.judgeVerdict)
      .map((t) => t.judgeVerdict!.totalScore);
    const aggregate = judgeScores.length > 0
      ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length
      : 0;
    const status = aggregate >= this.config.judge.passThreshold ? "passed" : "failed";

    // Update scenario run
    await prisma.scenarioRun.update({
      where: { id: scenarioRun.id },
      data: {
        status,
        totalRounds: turns.length,
        aggregate,
        completedAt: new Date(),
      },
    });

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      turns,
      analysisResults,
      aggregate,
      status,
    };
  }

  private async askQuestion(
    scenarioRunId: string,
    question: string,
    conversationHistory: Message[],
    roundNumber: number,
    turnType: "seed" | "follow_up",
    seedQuestionDbId?: string
  ): Promise<{ turn: ConversationTurn; conversationId: string; responseVec: number[] }> {
    const askedAt = new Date();
    const messageHistory: Message[] = [
      ...conversationHistory,
      { role: "user", content: question },
    ];

    const start = performance.now();
    const response = await this.deps.model.send(messageHistory);
    const latencyMs = Math.round(performance.now() - start);
    const respondedAt = new Date();

    // Save conversation to DB
    const conversation = await prisma.conversation.create({
      data: {
        scenarioRunId,
        roundNumber,
        turnType,
        seedQuestionId: seedQuestionDbId,
        question,
        response: response.content,
        latencyMs,
        askedAt,
        respondedAt,
      },
    });

    // Store responseEmbedding for the response
    const responseVec = await this.deps.embedder.embed(response.content, "response_embedding");
    await prisma.$executeRaw`
      UPDATE "Conversation"
      SET "responseEmbedding" = ${`[${responseVec.join(",")}]`}::vector
      WHERE id = ${conversation.id}
    `;

    const turn: ConversationTurn = {
      roundNumber,
      type: turnType,
      question,
      response: response.content,
      latencyMs,
    };

    return { turn, conversationId: conversation.id, responseVec };
  }

  private async saveJudgeVerdict(conversationId: string, turn: ConversationTurn): Promise<void> {
    if (!turn.judgeVerdict) return;
    await prisma.judgeVerdict.create({
      data: {
        conversationId,
        completenessScore: turn.judgeVerdict.completenessScore,
        coherenceScore: turn.judgeVerdict.coherenceScore,
        totalScore: turn.judgeVerdict.totalScore,
        passed: turn.judgeVerdict.passed,
        reasoning: turn.judgeVerdict.reasoning,
        rawLlmResponse: turn.judgeVerdict.rawLlmResponse,
        judgeModel: this.config.llm.model,
      },
    });
  }

  private async getExpectedEmbedding(seedQuestionDbId: string): Promise<number[] | null> {
    const rows = await prisma.$queryRaw<{ embedding: string }[]>`
      SELECT "expectedEmbedding"::text AS embedding
      FROM "SeedQuestion"
      WHERE id = ${seedQuestionDbId}
        AND "expectedEmbedding" IS NOT NULL
    `;
    if (rows.length === 0 || !rows[0]?.embedding) return null;
    // Parse "[0.1,0.2,...]" string into number[]
    return rows[0]!.embedding.slice(1, -1).split(",").map(Number);
  }

  private buildSummary(scenarioReports: ScenarioReport[]): TestSummary {
    const totalScenarios = scenarioReports.length;
    const totalTurns = scenarioReports.reduce((sum, r) => sum + r.turns.length, 0);
    const averageScore = totalScenarios > 0
      ? scenarioReports.reduce((sum, r) => sum + r.aggregate, 0) / totalScenarios
      : 0;
    const status = averageScore >= this.config.judge.passThreshold ? "passed" : "failed";

    return { totalScenarios, totalTurns, averageScore, status };
  }
}
