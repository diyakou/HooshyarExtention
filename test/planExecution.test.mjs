import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "../out/messageNormalizer.js";

describe("Plan Execution & System Prompt tests", () => {
  it("includes autonomous execution instructions in AGENT MODE system prompt", async () => {
    const base = "You operate in AGENT MODE: you plan multi-step work yourself.";
    const prompt = await buildSystemPrompt(base);
    assert.ok(prompt.includes("PERSISTENT PLANNING & AUTONOMOUS EXECUTION"));
    assert.ok(prompt.includes("CRITICAL: Once you start executing a plan, DO NOT stop after step 1!"));
    assert.ok(prompt.includes(".hooshyar/PLAN.md"));
  });

  it("identifies unfinished tasks in task lists correctly", () => {
    const tasks = [
      { id: "1", content: "Design schema", status: "completed" },
      { id: "2", content: "Implement feature", status: "in_progress" },
      { id: "3", content: "Write tests", status: "pending" }
    ];
    const pendingTasks = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
    assert.equal(pendingTasks.length, 2);

    // After completing all tasks
    const allCompleted = tasks.map((t) => ({ ...t, status: "completed" }));
    const remaining = allCompleted.filter((t) => t.status === "pending" || t.status === "in_progress");
    assert.equal(remaining.length, 0);
  });
});
