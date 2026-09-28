import test from "node:test";
import assert from "node:assert/strict";
import { SubAgentOrchestrator } from "../out/agent/subAgentOrchestrator.js";

test("SubAgentOrchestrator validates bounded specialist tasks", async () => {
  const orchestrator = new SubAgentOrchestrator();
  await assert.rejects(() => orchestrator.run("", [{ role: "architecture" }]), /requires a goal/);
  await assert.rejects(() => orchestrator.run("inspect project", []), /At least one/);
});
