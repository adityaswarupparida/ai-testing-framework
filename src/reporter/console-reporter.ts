import type { Reporter, TestReport } from "../types/report";

export class ConsoleReporter implements Reporter {
  async report(testReport: TestReport): Promise<void> {
    const { summary, scenarios } = testReport;

    console.log("\n" + "=".repeat(70));
    console.log(`  TEST RUN: ${testReport.runName}`);
    console.log(`  Model: ${testReport.modelUnderTest}`);
    console.log(`  Status: ${summary.status.toUpperCase()}`);
    console.log("=".repeat(70));

    for (const scenario of scenarios) {
      const statusIcon = scenario.status === "passed" ? "[PASS]" : "[FAIL]";
      console.log(`\n${statusIcon} ${scenario.scenarioName} (score: ${scenario.aggregate.toFixed(2)})`);
      console.log("-".repeat(50));

      for (const turn of scenario.turns) {
        const judgeScore = turn.judgeVerdict
          ? `judge: ${turn.judgeVerdict.totalScore.toFixed(2)}`
          : "no verdict";
        const typeLabel = turn.type === "seed" ? "SEED" : "FOLLOW-UP";

        console.log(`  [${typeLabel}] Round ${turn.roundNumber} (${judgeScore}, ${turn.latencyMs}ms)`);
        console.log(`    Q: ${this.truncate(turn.question, 80)}`);
        console.log(`    A: ${this.truncate(turn.response, 80)}`);

        if (turn.judgeVerdict) {
          console.log(`    Reasoning: ${this.truncate(turn.judgeVerdict.reasoning, 80)}`);
        }
      }

      if (scenario.analysisResults.length > 0) {
        console.log(`\n  Analysis:`);
        for (const result of scenario.analysisResults) {
          const humanFlag = result.isHumanNeed ? " [NEEDS HUMAN REVIEW]" : "";
          console.log(`    ${result.strategy}: ${result.score.toFixed(2)}${humanFlag}`);
          if (result.difference !== undefined) {
            console.log(`      difference (analysis - judge): ${result.difference.toFixed(2)}`);
          }
        }
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(`  SUMMARY`);
    console.log(`  Scenarios: ${summary.totalScenarios} | Turns: ${summary.totalTurns}`);
    console.log(`  Average Score: ${summary.averageScore.toFixed(2)}`);
    console.log(`  Overall: ${summary.status.toUpperCase()}`);
    console.log("=".repeat(70) + "\n");
  }

  private truncate(text: string, maxLen: number): string {
    const singleLine = text.replace(/\n/g, " ");
    return singleLine.length > maxLen
      ? singleLine.slice(0, maxLen - 3) + "..."
      : singleLine;
  }
}
