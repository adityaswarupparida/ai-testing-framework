import { test, expect, describe } from "bun:test";
import { loadConfig, loadScenario } from "../src/config/loader";

describe("loadConfig", () => {
  test("loads and validates default config structure", async () => {
    const config = await loadConfig("config/default.config.json");
    expect(config.sut.adapterType).toBeDefined();
    expect(config.sut.name).toBeDefined();
    expect(config.llm.provider).toBeDefined();
    expect(config.llm.model).toBeDefined();
    expect(typeof config.judge.passThreshold).toBe("number");
    expect(typeof config.analyzer.weights.exact).toBe("number");
    expect(typeof config.analyzer.weights.semantic).toBe("number");
    expect(config.analyzer.weights.exact + config.analyzer.weights.semantic).toBeCloseTo(1.0);
  });

  test("throws for missing config file", async () => {
    expect(loadConfig("nonexistent.json")).rejects.toThrow();
  });
});

describe("loadScenario", () => {
  test("loads a scenario with required fields", async () => {
    const scenario = await loadScenario("config/scenarios/medicine-availability.json");
    expect(scenario.id).toBeDefined();
    expect(scenario.name).toBeDefined();
    expect(scenario.seedQuestions.length).toBeGreaterThan(0);
    expect(typeof scenario.maxFollowUpRounds).toBe("number");
  });

  test("each seed question has ground truth with expected answer", async () => {
    const scenario = await loadScenario("config/scenarios/clinic-timings.json");
    for (const q of scenario.seedQuestions) {
      expect(q.id).toBeDefined();
      expect(q.question).toBeDefined();
      expect(q.groundTruth).toBeDefined();
      expect(q.groundTruth.expectedAnswer).toBeDefined();
      expect(q.groundTruth.expectedAnswer.length).toBeGreaterThan(0);
    }
  });

  test("seed questions have unique ids within a scenario", async () => {
    const scenario = await loadScenario("config/scenarios/general-inquiry.json");
    const ids = scenario.seedQuestions.map((q) => q.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("throws for missing scenario file", async () => {
    expect(loadScenario("nonexistent.json")).rejects.toThrow();
  });
});
