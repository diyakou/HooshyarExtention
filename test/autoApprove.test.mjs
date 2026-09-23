import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const vscode = require("vscode");
import { ApprovalManager } from "../out/approvalManager.js";

test("ApprovalManager and Auto-Approve Tests", async (t) => {
  t.beforeEach(() => {
    vscode.workspace._clearConfig();
  });

  t.afterEach(() => {
    vscode.workspace._clearConfig();
  });

  await t.test("shouldAutoApproveCommand requires approval by default", () => {
    const res = ApprovalManager.shouldAutoApproveCommand("npm run build");
    assert.equal(res.shouldAutoApprove, false);
  });

  await t.test("shouldAutoApproveCommand auto-approves when autoApproveCommands is enabled", () => {
    vscode.workspace._setConfig("hooshyar.autoApproveCommands", true);
    const res = ApprovalManager.shouldAutoApproveCommand("npm install");
    assert.equal(res.shouldAutoApprove, true);
    assert.ok(res.reason?.includes("auto-approval"));
  });

  await t.test("shouldAutoApproveCommand auto-approves when requireApprovalForCommands is false", () => {
    vscode.workspace._setConfig("hooshyar.requireApprovalForCommands", false);
    const res = ApprovalManager.shouldAutoApproveCommand("cargo run");
    assert.equal(res.shouldAutoApprove, true);
  });

  await t.test("shouldAutoApproveCommand safe mode approves read-only and test commands", () => {
    vscode.workspace._setConfig("hooshyar.autoApproveMode", "safe");

    // Safe commands
    assert.equal(ApprovalManager.shouldAutoApproveCommand("git status").shouldAutoApprove, true);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("git diff").shouldAutoApprove, true);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("node --version").shouldAutoApprove, true);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("npm test").shouldAutoApprove, true);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("pytest").shouldAutoApprove, true);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("where git").shouldAutoApprove, true);

    // Destructive / modifying commands require approval in safe mode
    assert.equal(ApprovalManager.shouldAutoApproveCommand("npm publish").shouldAutoApprove, false);
    assert.equal(ApprovalManager.shouldAutoApproveCommand("rm -rf dist").shouldAutoApprove, false);
  });

  await t.test("shouldAutoApproveCommand all mode approves everything", () => {
    vscode.workspace._setConfig("hooshyar.autoApproveMode", "all");
    assert.equal(ApprovalManager.shouldAutoApproveCommand("npm run deploy").shouldAutoApprove, true);
  });

  await t.test("shouldAutoApproveWrite respects requireApprovalForWrites", () => {
    vscode.workspace._setConfig("hooshyar.requireApprovalForWrites", false);
    const res = ApprovalManager.shouldAutoApproveWrite("src/index.ts", 100, false);
    assert.equal(res.shouldAutoApprove, true);
  });

  await t.test("shouldAutoApproveWrite safe mode approves small safe docs/tests and active editor file", () => {
    vscode.workspace._setConfig("hooshyar.autoApproveMode", "safe");
    vscode.workspace._setConfig("hooshyar.autoApproveSizeLimit", 5000);

    // Safe docs or test files
    const docRes = ApprovalManager.shouldAutoApproveWrite("docs/guide.md", 500, false);
    assert.equal(docRes.shouldAutoApprove, true);

    const testRes = ApprovalManager.shouldAutoApproveWrite("tests/app.test.ts", 1000, false);
    assert.equal(testRes.shouldAutoApprove, true);

    // Active file match
    const activeRes = ApprovalManager.shouldAutoApproveWrite("src/app.ts", 200, false, "src/app.ts");
    assert.equal(activeRes.shouldAutoApprove, true);

    // Large files exceed limit
    const largeRes = ApprovalManager.shouldAutoApproveWrite("src/app.ts", 20000, false, "src/app.ts");
    assert.equal(largeRes.shouldAutoApprove, false);
  });
});
