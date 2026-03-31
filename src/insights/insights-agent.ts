import type { TestReport, ScenarioReport } from "../types/report";
import type { InsightsReport, ScenarioInsights, Issue, Priority } from "../types/insights";
import type { LlmProvider } from "../adapters/llm/provider";
import { runModelRules } from "./rules/model-rules";
import { runFrameworkRules } from "./rules/framework-rules";
import { buildModelOwnerPrompt } from "./prompts/model-owner-prompt";
import { buildFrameworkPrompt } from "./prompts/framework-prompt";

export class InsightsAgent {
  private llm: LlmProvider;
  private outputDir: string;

  constructor(llm: LlmProvider, outputDir: string = "./reports") {
    this.llm = llm;
    this.outputDir = outputDir;
  }

  async analyze(report: TestReport): Promise<void> {
    console.log("\n[Insights Agent] Analyzing test report...");

    // Run all scenarios in parallel
    const scenarioInsights = await Promise.all(
      report.scenarios.map((scenario) => this.analyzeScenario(scenario))
    );

    const modelOwnerReport = this.buildReport(report, scenarioInsights, "model-owner");
    const frameworkReport = this.buildReport(report, scenarioInsights, "framework");

    await this.saveReport(modelOwnerReport, `${this.outputDir}/analysis/${report.runId}-model-owner.json`);
    await this.saveReport(frameworkReport, `${this.outputDir}/analysis/${report.runId}-framework.json`);

    console.log(`[Insights Agent] Model owner report: ${this.outputDir}/analysis/${report.runId}-model-owner.json`);
    console.log(`[Insights Agent] Framework report:   ${this.outputDir}/analysis/${report.runId}-framework.json`);
  }

  private async analyzeScenario(scenario: ScenarioReport): Promise<ScenarioInsights> {
    // Rule-based pass
    const modelRuleIssues = runModelRules(scenario);
    const frameworkRuleIssues = runFrameworkRules(scenario);

    // LLM pass — both in parallel
    const [modelLlmIssues, frameworkLlmIssues] = await Promise.all([
      this.runLlmAnalysis(buildModelOwnerPrompt(scenario, modelRuleIssues)),
      this.runLlmAnalysis(buildFrameworkPrompt(scenario, frameworkRuleIssues)),
    ]);

    console.log(`  [${scenario.scenarioName}] model: ${modelRuleIssues.length + modelLlmIssues.length} issues | framework: ${frameworkRuleIssues.length + frameworkLlmIssues.length} issues`);

    return {
      scenarioId: scenario.scenarioId,
      scenarioName: scenario.scenarioName,
      modelOwnerIssues: [...modelRuleIssues, ...modelLlmIssues],
      frameworkIssues: [...frameworkRuleIssues, ...frameworkLlmIssues],
    };
  }

  private async runLlmAnalysis(prompt: string): Promise<Issue[]> {
    try {
      const response = await this.llm.complete([
        { role: "user", content: prompt },
      ], { temperature: 0.1 });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed.issues) ? parsed.issues : [];
    } catch {
      return [];
    }
  }

  private buildReport(
    report: TestReport,
    scenarioInsights: ScenarioInsights[],
    type: "model-owner" | "framework"
  ): InsightsReport {
    const allIssues = scenarioInsights.flatMap((s) =>
      type === "model-owner" ? s.modelOwnerIssues : s.frameworkIssues
    );

    const byPriority: Record<Priority, number> = {
      critical: 0, high: 0, medium: 0, low: 0,
    };
    for (const issue of allIssues) {
      byPriority[issue.priority]++;
    }

    return {
      runId: report.runId,
      runName: report.runName,
      modelUnderTest: report.modelUnderTest,
      generatedAt: new Date().toISOString(),
      scenarios: scenarioInsights,
      summary: {
        totalIssues: allIssues.length,
        byPriority,
      },
    };
  }

  private async saveReport(report: InsightsReport, path: string): Promise<void> {
    await Bun.write(path, JSON.stringify(report, null, 2));
  }
}
