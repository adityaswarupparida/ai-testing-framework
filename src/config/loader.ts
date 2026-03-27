import type { TestScenario } from "../types";

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
