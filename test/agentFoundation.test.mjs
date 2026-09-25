import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../out/tools/registry.js";
import { classifyTool } from "../out/tools/createRegistry.js";
import { ContextEngine } from "../out/context/contextEngine.js";
import { AgentStateMachine } from "../out/agent/agentState.js";
import { detectModelCapabilities } from "../out/modelCapabilities.js";

test("Agent foundation", async (t) => {
  await t.test("ToolRegistry registers, validates, invokes, truncates, and emits telemetry", async () => {
    const events = [];
    const registry = new ToolRegistry({ defaultMaxResultChars: 5, onTelemetry: (event) => events.push(event) });
    registry.register({
      name: "echo",
      description: "Echo input",
      inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      category: "agent",
      risk: "read",
      parallelSafe: true,
      execute: async (input) => input.value
    });

    assert.deepEqual(registry.getDefinitions().map((tool) => tool.name), ["echo"]);
    await assert.rejects(registry.invoke("echo", {}), (error) => error.code === "TOOL_INPUT_INVALID");
    await assert.rejects(registry.invoke("echo", { value: 42 }), (error) => error.code === "TOOL_INPUT_INVALID");
    const result = await registry.invoke("echo", { value: "123456" }, { invocationId: "inv-1" });
    assert.equal(result.invocationId, "inv-1");
    assert.equal(result.truncated, true);
    assert.match(result.output, /^12345/);
    assert.equal(events.at(-1).success, true);
    registry.setEnabled("echo", false);
    await assert.rejects(registry.invoke("echo", { value: "hidden" }), (error) => error.code === "TOOL_DISABLED");
  });

  await t.test("ToolRegistry enforces universal timeouts", async () => {
    const registry = new ToolRegistry({ defaultTimeoutMs: 10 });
    registry.register({
      name: "slow",
      description: "Slow tool",
      inputSchema: { type: "object" },
      category: "agent",
      risk: "read",
      execute: () => new Promise((resolve) => setTimeout(() => resolve("late"), 100))
    });
    await assert.rejects(registry.invoke("slow", {}), (error) => error.code === "TOOL_TIMEOUT");
  });

  await t.test("tool classification keeps unknown and MCP operations sequential", () => {
    assert.deepEqual(classifyTool("run_command"), { category: "terminal", risk: "execute", parallelSafe: false });
    assert.equal(classifyTool("read_file").parallelSafe, true);
    assert.equal(classifyTool("mcp_figma_get_file").parallelSafe, false);
    assert.equal(classifyTool("mcp_db_update_row").risk, "write");
  });

  await t.test("ContextEngine ranks context within a token budget while preserving essentials", () => {
    const engine = new ContextEngine();
    const selection = engine.select([
      { id: "essential", source: "workspace", content: "root", relevance: 1, priority: 1, estimatedTokens: 5, essential: true },
      { id: "high", source: "diagnostics", content: "error", relevance: 1, priority: 10, estimatedTokens: 4 },
      { id: "low", source: "recent", content: "old", relevance: 0.1, priority: 1, estimatedTokens: 4 }
    ], 9);
    assert.deepEqual(selection.items.map((item) => item.id), ["essential", "high"]);
    assert.equal(selection.omitted, 1);
  });

  await t.test("AgentStateMachine rejects invalid transitions", () => {
    const machine = new AgentStateMachine();
    machine.transition("REQUESTING_MODEL");
    machine.transition("WAITING_FOR_TOOL");
    machine.transition("RUNNING_TOOL");
    machine.transition("COMPLETED");
    assert.equal(machine.state, "COMPLETED");
    assert.throws(() => machine.transition("RUNNING_TOOL"), /Invalid agent state transition/);
  });

  await t.test("model capabilities are provider-aware", () => {
    const capabilities = detectModelCapabilities(
      { apiFormat: "anthropic", model: "claude-sonnet", toolProtocol: "native", enablePromptCaching: true },
      true
    );
    assert.equal(capabilities.tools, true);
    assert.equal(capabilities.reasoning, true);
    assert.equal(capabilities.promptCaching, true);
  });
});
