import { GeminiProvider } from "./src/adapters/llm/gemini-provider";
import { InsightsAgent } from "./src/insights/insights-agent";
import type { TestReport } from "./src/types/report";

const QUEUE_KEY = "insights:queue";
const OUTPUT_DIR = "./reports";

async function main() {
  console.log("[Insights Worker] Starting...");

  const llm = new GeminiProvider(process.env.INSIGHTS_MODEL ?? "gemini-2.5-flash");
  const agent = new InsightsAgent(llm, OUTPUT_DIR);

  // Ensure analysis output directory exists
  await Bun.$`mkdir -p ${OUTPUT_DIR}/analysis`.quiet();

  console.log(`[Insights Worker] Listening on queue '${QUEUE_KEY}'...`);

  while (true) {
    // Blocking pop — waits until a report arrives
    const result = await Bun.redis.brpop(QUEUE_KEY, 0);
    if (!result) continue;

    const [, payload] = result;

    try {
      const report = JSON.parse(payload) as TestReport;
      console.log(`\n[Insights Worker] Processing run: ${report.runId} (${report.runName})`);
      await agent.analyze(report);
      console.log(`[Insights Worker] Done — run ${report.runId}`);
    } catch (err) {
      console.error("[Insights Worker] Failed to process report:", err);
    }
  }
}

main().catch((err) => {
  console.error("[Insights Worker] Fatal error:", err);
  process.exit(1);
});
