import type { Reporter, TestReport } from "../types/report";

export class JsonReporter implements Reporter {
  private outputDir: string;

  constructor(outputDir: string = "./reports") {
    this.outputDir = outputDir;
  }

  async report(testReport: TestReport): Promise<void> {
    const fileName = `${this.outputDir}/${testReport.runId}.json`;
    await Bun.write(fileName, JSON.stringify(testReport, null, 2));
    console.log(`\nJSON report saved to: ${fileName}`);
  }
}
