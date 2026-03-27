import { prisma } from "../db/client";
import type { ConversationTurn, Message, TestScenario } from "../types";
import type { ModelAdapter } from "../types/model-adapter";
import type { Judge } from "../types/judge";
import type { QuestionnaireAgent } from "../types/questionnaire";
import type { ResponseAnalyzer } from "../types/analyzer";
import type { Reporter, ScenarioReport, TestReport, TestSummary } from "../types/report";
import type { FrameworkConfig } from "../config/loader";
import type { TrackedLlmProvider } from "../adapters/llm/tracked-provider";

export interface TestRunnerDeps {
  model: ModelAdapter;
  judge: Judge;
  questionnaire: QuestionnaireAgent;
  analyzer: ResponseAnalyzer;
  reporters: Reporter[];
  trackedProviders: TrackedLlmProvider[];
}

export class TestRunner {
  private config: FrameworkConfig;
  private deps: TestRunnerDeps;

  constructor(config: FrameworkConfig, deps: TestRunnerDeps) {
    this.config = config;
    this.deps = deps;
  }

  async run(scenarios: TestScenario[], runName?: string): Promise<TestReport> {
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

    // Set test run ID on tracked providers for LLM call logging
    for (const provider of this.deps.trackedProviders) {
      provider.setTestRunId(testRun.id);
    }

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
      const scenario = scenarios[i];
      console.log(`\n[${i + 1}/${scenarios.length}] Scenario: ${scenario.name} (${scenario.seedQuestions.length} seed + ${scenario.maxFollowUpRounds} follow-up rounds)`);
      const report = await this.runScenario(testRun.id, scenario);
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
    scenario: TestScenario
  ): Promise<ScenarioReport> {
    const scenarioRun = await prisma.scenarioRun.create({
      data: {
        testRunId,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioConfig: scenario as any,
        status: "running",
      },
    });

    const allTurns: ConversationTurn[] = [];
    const allAnalysisResults: import("../types/analyzer").AnalysisResult[] = [];
    const maxRounds = scenario.maxFollowUpRounds || this.config.questionnaire.maxFollowUpRounds;
    const totalSeeds = scenario.seedQuestions.length;
    let roundCounter = 0;

    for (let qi = 0; qi < totalSeeds; qi++) {
      const seedQuestion = scenario.seedQuestions[qi];
      const seedTurns: ConversationTurn[] = [];
      const seedHistory: Message[] = [];

      // Reset model state for each seed question's conversation
      if (this.deps.model.reset) {
        await this.deps.model.reset();
      }

      // -- Seed question --
      console.log(`\n  [Seed ${qi + 1}/${totalSeeds}] "${seedQuestion.question.slice(0, 60)}"`);
      roundCounter++;
      const seedTurn = await this.askQuestion(
        scenarioRun.id,
        seedQuestion.question,
        seedHistory,
        roundCounter,
        "seed",
        seedQuestion.id
      );

      seedTurn.judgeVerdict = await this.deps.judge.evaluate(
        seedTurn,
        [seedTurn],
        seedQuestion.groundTruth
      );
      await this.saveJudgeVerdict(scenarioRun.id, seedTurn);
      console.log(`    -> judge: ${seedTurn.judgeVerdict.totalScore.toFixed(2)} (${seedTurn.latencyMs}ms)`);

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
        const followTurn = await this.askQuestion(
          scenarioRun.id,
          followUpQuestion,
          seedHistory,
          roundCounter,
          "follow_up"
        );

        followTurn.judgeVerdict = await this.deps.judge.evaluate(followTurn, seedTurns.concat(followTurn));
        await this.saveJudgeVerdict(scenarioRun.id, followTurn);
        console.log(`    Follow-up ${fi + 1}/${maxRounds}: "${followUpQuestion.slice(0, 50)}..." -> judge: ${followTurn.judgeVerdict.totalScore.toFixed(2)} (${followTurn.latencyMs}ms)`);

        seedHistory.push(
          { role: "user", content: followTurn.question },
          { role: "assistant", content: followTurn.response }
        );
        seedTurns.push(followTurn);
      }

      allTurns.push(...seedTurns);

      // -- Analysis for this seed's response --
      process.stdout.write(`    Analysis: `);
      const seedAnalysis = await this.deps.analyzer.analyzeAll(
        [seedTurns[0]],
        [seedQuestion.groundTruth]
      );
      const analysisSummary: string[] = [];
      for (const result of seedAnalysis) {
        analysisSummary.push(`${result.strategy}: ${result.score.toFixed(2)}`);
        const conversationRecord = await prisma.conversation.findFirst({
          where: { scenarioRunId: scenarioRun.id, roundNumber: seedTurns[0].roundNumber },
        });
        if (conversationRecord) {
          await prisma.analysisResult.create({
            data: {
              conversationId: conversationRecord.id,
              strategy: result.strategy,
              score: result.score,
              groundTruth: result.groundTruth,
              judgeScore: result.judgeScore,
              difference: result.difference,
              isHumanNeed: result.isHumanNeed,
            },
          });
        }
      }
      const humanNeeded = seedAnalysis.some((r) => r.isHumanNeed);
      console.log(`${analysisSummary.join(" | ")}${humanNeeded ? " [NEEDS HUMAN REVIEW]" : ""}`);
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
    seedQuestionId?: string
  ): Promise<ConversationTurn> {
    const askedAt = new Date();
    const messageHistory: Message[] = [
      ...conversationHistory,
      { role: "user", content: question },
    ];

    const start = performance.now();
    const response = await this.deps.model.send(messageHistory);
    const latencyMs = Math.round(performance.now() - start);
    const respondedAt = new Date();

    // Save to DB
    await prisma.conversation.create({
      data: {
        scenarioRunId,
        roundNumber,
        turnType,
        seedQuestionId,
        question,
        response: response.content,
        latencyMs,
        askedAt,
        respondedAt,
      },
    });

    return {
      roundNumber,
      type: turnType,
      question,
      response: response.content,
      latencyMs,
    };
  }

  private async saveJudgeVerdict(scenarioRunId: string, turn: ConversationTurn): Promise<void> {
    if (!turn.judgeVerdict) return;
    const conversationRecord = await prisma.conversation.findFirst({
      where: { scenarioRunId, roundNumber: turn.roundNumber },
    });
    if (conversationRecord) {
      await prisma.judgeVerdict.create({
        data: {
          conversationId: conversationRecord.id,
          accuracyScore: turn.judgeVerdict.accuracyScore,
          relevanceScore: turn.judgeVerdict.relevanceScore,
          totalScore: turn.judgeVerdict.totalScore,
          reasoning: turn.judgeVerdict.reasoning,
          rawResponse: turn.judgeVerdict.rawResponse,
          judgeModel: this.config.llm.model,
        },
      });
    }
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
