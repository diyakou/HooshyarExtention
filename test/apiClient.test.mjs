import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterDelayMs } from "../out/apiClient.js";
import { normalizeModelsUrl } from "../out/apiConfig.js";
import { buildRequestHeaders, readInlineApiConfig } from "../out/apiConfig.js";

test("API Client Resilience Tests", async (t) => {
  await t.test("normalizeModelsUrl targets v1/models from supported base URL forms", () => {
    assert.equal(normalizeModelsUrl("https://api.example.com/v1"), "https://api.example.com/v1/models");
    assert.equal(normalizeModelsUrl("https://api.example.com/v1/messages"), "https://api.example.com/v1/models");
    assert.equal(normalizeModelsUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/models");
  });
  await t.test("parseRetryAfterDelayMs parses integer seconds correctly", () => {
    const delay = parseRetryAfterDelayMs("5", 1000);
    assert.equal(delay, 5000);
  });

  await t.test("parseRetryAfterDelayMs parses fractional seconds", () => {
    const delay = parseRetryAfterDelayMs("2.5", 1000);
    assert.equal(delay, 2500);
  });

  await t.test("parseRetryAfterDelayMs caps delay at 60 seconds", () => {
    const delay = parseRetryAfterDelayMs("120", 1000);
    assert.equal(delay, 60000);
  });

  await t.test("parseRetryAfterDelayMs returns fallback for null or empty header", () => {
    assert.equal(parseRetryAfterDelayMs(null, 1500), 1500);
    assert.equal(parseRetryAfterDelayMs("", 2000), 2000);
  });

  await t.test("parseRetryAfterDelayMs parses HTTP date string", () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const delay = parseRetryAfterDelayMs(futureDate, 1000);
    assert.ok(delay >= 8000 && delay <= 11000, `Expected delay close to 10000ms, got ${delay}`);
  });

  await t.test("buildRequestHeaders includes prompt-caching-2024-07-31 beta header for Anthropic", () => {
    const headers = buildRequestHeaders({
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "test-key",
      model: "claude-sonnet-5",
      maxTokens: 4096,
      temperature: 1,
      extraHeaders: {},
      maxRetries: 2,
      requestTimeoutMs: 10000,
      toolProtocol: "auto",
      apiFormat: "anthropic"
    });
    assert.equal(headers["anthropic-beta"], "prompt-caching-2024-07-31");
    assert.equal(headers["anthropic-version"], "2023-06-01");
  });

  await t.test("readInlineApiConfig defaults to cheap fast model to save tokens", () => {
    const cfg = readInlineApiConfig("test-key");
    assert.equal(cfg.model, "claude-3-5-haiku");
    assert.equal(cfg.maxTokens, 256);
  });
});

