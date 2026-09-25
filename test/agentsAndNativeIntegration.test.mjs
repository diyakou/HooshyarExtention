import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { PlannerAgent } from "../out/agent/planner.js";
import { TerminalManager } from "../out/terminal/terminalManager.js";
import { TaskProvider } from "../out/taskIntegration/taskProvider.js";
import { HooshyarTestExplorer } from "../out/testing/testExplorerProvider.js";
import { TestFrameworkDetector } from "../out/testing/testFrameworkDetector.js";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Agent and native integration", async (t) => {
  await t.test("planner persists a revisable dependency-aware plan", async () => {
    const originalFolders = vscode.workspace.workspaceFolders.splice(0);
    const originalFs = vscode.workspace.fs;
    const writes = new Map();
    vscode.workspace.workspaceFolders.push({ name: "workspace", index: 0, uri: vscode.Uri.file("/workspace") });
    vscode.workspace.fs = {
      createDirectory: async () => {},
      writeFile: async (uri, content) => writes.set(uri.fsPath.replace(/\\/g, "/"), Buffer.from(content).toString("utf8"))
    };
    try {
      const planner = new PlannerAgent();
      const plan = await planner.createPlan("implement retry support", "");
      assert.equal(plan.steps.length, 4);
      assert.equal((await planner.getNextStep())?.id, "step-1");
      await planner.updateStep("step-1", { status: "completed", result: "located client" });
      const revision = await planner.revisePlan("step-2", "use existing retry helper");
      assert.equal(revision.status, "pending");
      assert.ok([...writes.values()].some((value) => value.includes("use existing retry helper")));
    } finally {
      vscode.workspace.fs = originalFs;
      vscode.workspace.workspaceFolders.splice(0, vscode.workspace.workspaceFolders.length, ...originalFolders);
    }
  });

  await t.test("terminal manager reuses named sessions and exposes buffered output", () => {
    const manager = new TerminalManager();
    const first = manager.getOrCreateTerminal("Hooshyar Test");
    const second = manager.getOrCreateTerminal("Hooshyar Test");
    assert.equal(first, second);
    manager.executeInTerminal("Hooshyar Test", "npm test", { show: false });
    assert.deepEqual(manager.listTerminals(), ["Hooshyar Test"]);
    assert.equal(manager.getOutput("Hooshyar Test"), "");
    manager.dispose();
  });

  await t.test("task provider returns categorized common workspace tasks", async () => {
    const originalFolders = vscode.workspace.workspaceFolders.splice(0);
    vscode.workspace.workspaceFolders.push({ name: "workspace", index: 0, uri: vscode.Uri.file("/workspace") });
    try {
      const provider = new TaskProvider();
      const tasks = await provider.provideTasks();
      assert.equal(tasks.length, 5);
      assert.equal(tasks.find((task) => task.name === "Test")?.group, vscode.TaskGroup.Test);
      assert.deepEqual(provider.getDependencies("missing"), []);
    } finally {
      vscode.workspace.workspaceFolders.splice(0, vscode.workspace.workspaceFolders.length, ...originalFolders);
    }
  });

  await t.test("framework detector and Test Explorer use the native integration contracts", async () => {
    const originalFs = vscode.workspace.fs;
    vscode.workspace.fs = {
      readFile: async (uri) => {
        if (uri.fsPath.endsWith("package.json")) return Buffer.from(JSON.stringify({ devDependencies: { jest: "1" }, scripts: { test: "node --test" } }));
        throw new Error("missing");
      },
      stat: async () => { throw new Error("missing"); }
    };
    try {
      const detected = await new TestFrameworkDetector().detect("/workspace");
      assert.equal(detected.framework, "jest");
      const explorer = new HooshyarTestExplorer();
      explorer.dispose();
    } finally {
      vscode.workspace.fs = originalFs;
    }
  });
});
