import test from "node:test";
import assert from "node:assert/strict";
import { buildCommitPrompt } from "../out/gitCommitGenerator.js";
import { buildDiagnosticPrompt } from "../out/quickFixProvider.js";
import { buildInlineEditPrompt } from "../out/inlineChatProvider.js";
import { ReviewManager } from "../out/reviewManager.js";

test("Copilot Parity Features Tests", async (t) => {
  await t.test("buildCommitPrompt formats git diff into conventional commit instructions", () => {
    const diff = "diff --git a/src/app.ts b/src/app.ts\n+console.log('hello');";
    const prompt = buildCommitPrompt(diff);
    assert.ok(prompt.includes("Conventional Commit"));
    assert.ok(prompt.includes("GIT DIFF:"));
    assert.ok(prompt.includes("console.log('hello');"));
  });

  await t.test("buildDiagnosticPrompt creates targeted fix and explain prompts", () => {
    const mockDoc = {
      uri: { fsPath: "e:/project/src/index.ts" },
      languageId: "typescript",
      lineCount: 10,
      lineAt: () => ({ range: { end: { character: 20 } } }),
      getText: () => "const a: number = 'string';"
    };
    const mockDiag = {
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      message: "Type 'string' is not assignable to type 'number'.",
      source: "ts"
    };

    const fixPrompt = buildDiagnosticPrompt(mockDoc, mockDiag, "fix");
    assert.ok(fixPrompt.includes("/fix"));
    assert.ok(fixPrompt.includes("Type 'string' is not assignable"));
    assert.ok(fixPrompt.includes("search_replace"));

    const explainPrompt = buildDiagnosticPrompt(mockDoc, mockDiag, "explain");
    assert.ok(explainPrompt.includes("/explain"));
    assert.ok(explainPrompt.includes("Why is this error happening"));
  });

  await t.test("buildInlineEditPrompt formats instruction with code context", () => {
    const prompt = buildInlineEditPrompt(
      "javascript",
      "Add error handling",
      "fetch('/api')",
      "const url = '/api';"
    );
    assert.ok(prompt.includes("Add error handling"));
    assert.ok(prompt.includes("fetch('/api')"));
    assert.ok(prompt.includes("const url = '/api';"));
    assert.ok(prompt.includes("Return ONLY the replacement code"));
  });

  await t.test("ReviewManager tracks, lists, and clears modified files", () => {
    const rm = ReviewManager.getInstance();
    rm.clear();
    assert.equal(rm.getModifiedFiles().length, 0);

    rm.trackFile("src/index.ts");
    rm.trackFile("src/utils.ts");
    rm.trackFile("src/index.ts"); // duplicate check

    const files = rm.getModifiedFiles();
    assert.equal(files.length, 2);
    assert.ok(files.includes("src/index.ts"));
    assert.ok(files.includes("src/utils.ts"));

    rm.acceptAll();
    assert.equal(rm.getModifiedFiles().length, 0);
  });
});
