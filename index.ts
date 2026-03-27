import { loadConfig, loadScenarios } from "./src/config/loader";
import { GeminiProvider } from "./src/adapters/llm/gemini-provider";
import { TrackedLlmProvider } from "./src/adapters/llm/tracked-provider";
import { HttpModelAdapter } from "./src/adapters/model/http-adapter";
import { FunctionModelAdapter } from "./src/adapters/model/function-adapter";
import { LlmJudge } from "./src/judge/llm-judge";
import { LlmQuestionnaireAgent } from "./src/questionnaire/llm-questionnaire";
import { CompositeAnalyzer } from "./src/analyzer/composite-analyzer";
import { TestRunner } from "./src/runner/test-runner";
import { JsonReporter } from "./src/reporter/json-reporter";
import { ConsoleReporter } from "./src/reporter/console-reporter";
import { glob } from "node:fs/promises";
import type { ModelAdapter } from "./src/types/model-adapter";

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI args
  let configPath = "config/default.config.json";
  const scenarioPaths: string[] = [];
  let runName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--config":
        configPath = args[++i];
        break;
      case "--scenario":
        scenarioPaths.push(args[++i]);
        break;
      case "--name":
        runName = args[++i];
        break;
      case "--help":
        printUsage();
        process.exit(0);
    }
  }

  // Load config
  const config = await loadConfig(configPath);

  // Load scenarios
  let scenarios;
  if (scenarioPaths.length > 0) {
    scenarios = await loadScenarios(scenarioPaths);
  } else {
    // Default: load all scenarios from config/scenarios/
    const defaultPaths: string[] = [];
    for await (const file of glob("config/scenarios/*.json")) {
      defaultPaths.push(file);
    }
    if (defaultPaths.length === 0) {
      console.error("No scenario files found. Use --scenario <path> or add files to config/scenarios/");
      process.exit(1);
    }
    scenarios = await loadScenarios(defaultPaths);
  }

  console.log(`Loaded ${scenarios.length} scenario(s)`);
  console.log(`Config: ${configPath}`);
  console.log(`Model: ${config.sut.name} (${config.sut.adapterType})`);
  console.log(`LLM: ${config.llm.provider}/${config.llm.model}`);

  // Create model adapter
  let model: ModelAdapter;
  if (config.sut.adapterType === "http") {
    if (!config.sut.baseUrl) throw new Error("HTTP adapter requires sut.baseUrl");
    model = new HttpModelAdapter(config.sut.name, config.sut.baseUrl);
  } else {
    throw new Error(
      "Function adapter cannot be configured via JSON. Use the TestRunner API directly."
    );
  }

  // Create LLM providers
  const baseProvider = new GeminiProvider(config.llm.model);
  const judgeProvider = new TrackedLlmProvider(baseProvider, "judge");
  const questionnaireProvider = new TrackedLlmProvider(baseProvider, "questionnaire");
  const analyzerProvider = new TrackedLlmProvider(baseProvider, "semantic_analyzer");

  // Create components
  const judge = new LlmJudge(judgeProvider);
  const questionnaire = new LlmQuestionnaireAgent(
    questionnaireProvider,
    config.questionnaire.personaPrompt
  );
  const analyzer = new CompositeAnalyzer(analyzerProvider, config.analyzer.weights);

  // Create reporters
  const reporters = [];
  if (config.reporting.outputFormats.includes("console")) {
    reporters.push(new ConsoleReporter());
  }
  if (config.reporting.outputFormats.includes("json")) {
    reporters.push(new JsonReporter(config.reporting.outputDir));
  }

  // Run
  const runner = new TestRunner(config, {
    model,
    judge,
    questionnaire,
    analyzer,
    reporters,
    trackedProviders: [judgeProvider, questionnaireProvider, analyzerProvider],
  });

  console.log("\nStarting test run...\n");
  const report = await runner.run(scenarios, runName);

  process.exit(report.summary.status === "passed" ? 0 : 1);
}

function printUsage() {
  console.log(`
AI Testing Framework - Medical Clinic Receptionist

Usage:
  bun run index.ts [options]

Options:
  --config <path>    Path to config file (default: config/default.config.json)
  --scenario <path>  Path to scenario file (can specify multiple times)
  --name <name>      Name for this test run
  --help             Show this help message

Examples:
  bun run index.ts
  bun run index.ts --scenario config/scenarios/medicine-availability.json
  bun run index.ts --config my-config.json --name "Nightly Run"
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
