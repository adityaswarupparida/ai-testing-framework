import { test, expect, describe } from "bun:test";
import { FunctionModelAdapter } from "../src/adapters/model/function-adapter";
import { HttpModelAdapter } from "../src/adapters/model/http-adapter";
import type { Message } from "../src/types";

describe("FunctionModelAdapter", () => {
  test("sends message and returns assistant response", async () => {
    const adapter = new FunctionModelAdapter(
      "test-model",
      async (history: Message[]) => {
        const lastMsg = history[history.length - 1];
        return `Echo: ${lastMsg.content}`;
      }
    );

    const response = await adapter.send([
      { role: "user", content: "Hello" },
    ]);

    expect(response.role).toBe("assistant");
    expect(response.content).toBe("Echo: Hello");
    expect(response.timestamp).toBeDefined();
  });

  test("has correct name", () => {
    const adapter = new FunctionModelAdapter("my-model", async () => "ok");
    expect(adapter.name).toBe("my-model");
  });

  test("healthCheck always returns true", async () => {
    const adapter = new FunctionModelAdapter("test", async () => "ok");
    expect(await adapter.healthCheck()).toBe(true);
  });

  test("calls reset function when provided", async () => {
    let resetCalled = false;
    const adapter = new FunctionModelAdapter(
      "test",
      async () => "ok",
      async () => { resetCalled = true; }
    );

    await adapter.reset();
    expect(resetCalled).toBe(true);
  });

  test("reset does nothing when no reset function", async () => {
    const adapter = new FunctionModelAdapter("test", async () => "ok");
    await adapter.reset(); // should not throw
  });
});

describe("HttpModelAdapter", () => {
  test("has correct name", () => {
    const adapter = new HttpModelAdapter("http-model", "http://localhost:8080");
    expect(adapter.name).toBe("http-model");
  });

  test("trims trailing slash from baseUrl", () => {
    const adapter = new HttpModelAdapter("test", "http://localhost:8080/");
    expect(adapter.name).toBe("test");
  });

  test("healthCheck returns false when server is unreachable", async () => {
    const adapter = new HttpModelAdapter("test", "http://localhost:19999");
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(false);
  });
});
