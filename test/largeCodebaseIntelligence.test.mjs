import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ContextRanker,
  ContextBudgetManager,
  IncrementalIndexer,
  TaskMemoryManager,
  getTaskMemoryManager,
  RetrievalEngine,
  ValidationEngine,
  AgentRuntime,
  getAgentRuntime
} from "../out/intelligence/index.js";
import { truncateToolOutput } from "../out/toolCallParser.js";
import { readTextFileLineRange } from "../out/workspaceUtils.js";
import { readFileTool } from "../out/tools.js";
import { ChatViewProvider } from "../out/chatViewProvider.js";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Large Codebase Intelligence Architecture", async (t) => {

  // 1. Symbol Ranking
  await t.test("ContextRanker scores exact symbol matches higher than generic keyword matches", () => {
    const ranker = new ContextRanker();
    const exactItem = {
      id: "exact-1",
      content: "class AuthService { login() {} }",
      file: "src/auth/AuthService.ts",
      symbolName: "AuthService.login",
      signals: ["exactSymbolMatch"],
      score: 0,
      estimatedTokens: 10,
      source: "symbol"
    };
    const keywordItem = {
      id: "kw-1",
      content: "console.log('auth login error')",
      file: "src/utils/logger.ts",
      signals: ["keywordMatch"],
      score: 0,
      estimatedTokens: 8,
      source: "search"
    };

    const exactScore = ranker.scoreItem(exactItem);
    const keywordScore = ranker.scoreItem(keywordItem);

    assert.ok(exactScore > keywordScore, `Exact symbol score (${exactScore}) must exceed keyword score (${keywordScore})`);
    assert.equal(exactScore, 1.0);
  });

  await t.test("ContextRanker ranks multiple items correctly and selects within budget", () => {
    const ranker = new ContextRanker();
    const items = [
      { id: "1", content: "low priority content", file: "src/a.ts", signals: ["keywordMatch"], score: 0, estimatedTokens: 50, source: "search" },
      { id: "2", content: "highest priority content", file: "src/b.ts", signals: ["exactSymbolMatch"], score: 0, estimatedTokens: 50, source: "symbol" },
      { id: "3", content: "medium priority content", file: "src/c.ts", signals: ["directCaller"], score: 0, estimatedTokens: 50, source: "callers" }
    ];

    const ranked = ranker.rank(items);
    assert.equal(ranked[0].id, "2");
    assert.equal(ranked[1].id, "3");
    assert.equal(ranked[2].id, "1");

    // Budget of 120 tokens should select top 2 items
    const selected = ranker.selectTopN(items, 120);
    assert.equal(selected.length, 2);
    assert.equal(selected[0].id, "2");
    assert.equal(selected[1].id, "3");
  });

  await t.test("ContextRanker deduplicates items by file and symbol", () => {
    const ranker = new ContextRanker();
    const items = [
      { id: "1", content: "v1", file: "src/auth.ts", symbolName: "login", signals: ["keywordMatch"], score: 0, estimatedTokens: 10, source: "s1" },
      { id: "2", content: "v2", file: "src/auth.ts", symbolName: "login", signals: ["exactSymbolMatch"], score: 0, estimatedTokens: 10, source: "s2" }
    ];
    const deduped = ranker.deduplicateByFile(items);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].id, "2"); // Keeps item with higher score
  });

  // 2. Context Budget Pruning
  await t.test("ContextBudgetManager allocates slots and enforces soft/hard limits", () => {
    const budget = new ContextBudgetManager({ totalBudgetChars: 1000, softLimitPercent: 0.75, hardLimitPercent: 0.9 });

    assert.equal(budget.exceedsSoftLimit(), false);
    assert.equal(budget.exceedsHardLimit(), false);

    // Allocate 800 chars (exceeds soft limit 750)
    budget.allocate("codeContext", "A".repeat(800));
    assert.equal(budget.exceedsSoftLimit(), true);
    assert.equal(budget.exceedsHardLimit(), false);

    // Allocate 150 more (total 950, exceeds hard limit 900)
    budget.allocate("toolResults", "B".repeat(150));
    assert.equal(budget.exceedsHardLimit(), true);
  });

  await t.test("ContextBudgetManager compacts non-essential slots while protecting essential ones", () => {
    const budget = new ContextBudgetManager({ totalBudgetChars: 1000, softLimitPercent: 0.75, hardLimitPercent: 0.9 });

    // System is essential (priority 100, essential: true)
    budget.allocate("system", "SYSTEM_INSTRUCTIONS");
    // toolResults is non-essential (priority 40, essential: false)
    budget.allocate("toolResults", "X".repeat(800));

    assert.equal(budget.exceedsSoftLimit(), true);

    const compaction = budget.compact();
    assert.ok(compaction.removedChars > 0, "Compaction must free characters");

    const usage = budget.getUsage();
    assert.ok(usage.used <= 750, `Usage after compaction (${usage.used}) must be <= soft limit (750)`);
  });

  await t.test("ContextBudgetManager removes duplicate tool outputs", () => {
    const budget = new ContextBudgetManager();
    const history = [
      { role: "user", content: "find files" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_files", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "fileA.ts\nfileB.ts" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "list_files", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "fileA.ts\nfileB.ts" }] }
    ];

    const deduplicated = budget.removeDuplicateToolOutputs(history);
    // Older duplicate tool output content should be compacted with notice
    const olderDuplicate = deduplicated[2].content[0];
    const latestResult = deduplicated[4].content[0];
    assert.ok(olderDuplicate.content.includes("omitted"), "Older duplicate result should be marked omitted");
    assert.equal(latestResult.content, "fileA.ts\nfileB.ts", "Latest result should be kept intact");
  });

  // 3. Task Working Memory
  await t.test("TaskMemoryManager tracks structured state and produces compact summaries", () => {
    const memory = getTaskMemoryManager();
    memory.reset();

    const taskId = memory.createTask("Add refresh token rotation");
    assert.ok(taskId);

    memory.addRelevantSymbol("AuthService.login", { file: "src/auth/AuthService.ts", startLine: 120, endLine: 178 });
    memory.addRelevantSymbol("TokenService.createToken", { file: "src/auth/TokenService.ts", startLine: 45, endLine: 89 });
    memory.markFileInspected("src/auth/AuthService.ts");
    memory.trackFileModification("src/auth/AuthService.ts", "login", "modified");
    memory.addDecision("Use HMAC-SHA256 for token rotation", "Standard secure pattern");
    memory.addIssue("Missing token refresh tests");

    const summary = memory.toCompactSummary();
    assert.ok(summary.includes("Add refresh token rotation"));
    assert.ok(summary.includes("AuthService.login"));
    assert.ok(summary.includes("src/auth/AuthService.ts:120-178"));
    assert.ok(summary.includes("HMAC-SHA256"));
    assert.ok(summary.includes("Missing token refresh tests"));

    assert.equal(memory.isFileInspected("src/auth/AuthService.ts"), true);
    assert.equal(memory.isFileInspected("src/unknown.ts"), false);
  });

  await t.test("TaskMemoryManager caches and retrieves search results within TTL", () => {
    const memory = getTaskMemoryManager();
    memory.cacheSearchResult("AuthService", "found in src/auth/AuthService.ts");

    const cached = memory.getCachedSearchResult("AuthService");
    assert.equal(cached, "found in src/auth/AuthService.ts");

    const nonExistent = memory.getCachedSearchResult("NonExistentQuery");
    assert.equal(nonExistent, undefined);
  });

  // 4. Incremental Indexer & Project Map
  await t.test("IncrementalIndexer generates compact project map with depth limits", () => {
    const indexer = new IncrementalIndexer();
    // Default ignore patterns
    const defaultIgnores = ["node_modules", "dist", "build", ".git", "coverage"];
    for (const pattern of defaultIgnores) {
      assert.ok(indexer.isFileIndexed(pattern) === false);
    }
  });

  // 5. Intent Analysis in AgentRuntime
  await t.test("AgentRuntime analyzes intent and extracts likely primary symbols", () => {
    const runtime = getAgentRuntime();

    const editIntent = runtime.analyseIntent("Find the AuthService.login method and add refresh token rotation");
    assert.equal(editIntent.isEditIntent, true);
    assert.ok(editIntent.primarySymbols.includes("AuthService.login"));

    const infoIntent = runtime.analyseIntent("Explain what this project does and how it works");
    assert.equal(infoIntent.isEditIntent, false);

    const testIntent = runtime.analyseIntent("Run unit tests for UserController");
    assert.equal(testIntent.mentionsTests, true);
    assert.ok(testIntent.primarySymbols.includes("UserController"));
  });

  // 6. Exploration Policy
  await t.test("AgentRuntime enforces exploration policy to stop endless broad searches", () => {
    const runtime = getAgentRuntime();

    // 0 broad searches -> allowed
    const p1 = runtime.shouldContinueExploring(1, 0, 0, 0);
    assert.equal(p1.allowed, true);

    // 3 broad searches with 0 symbol retrievals -> discouraged
    const p2 = runtime.shouldContinueExploring(3, 3, 0, 0);
    assert.equal(p2.allowed, false);
    assert.ok(p2.guidance.includes("find_symbol") || p2.guidance.includes("targeted"));
  });

  // 7. Output Truncation
  await t.test("truncateToolOutput bounds long outputs while keeping heads and tails", () => {
    const hugeOutput = "START_LINE\n" + "x".repeat(30000) + "\nEND_LINE";
    const truncated = truncateToolOutput(hugeOutput, 4000);

    assert.ok(truncated.length <= 5000);
    assert.ok(truncated.includes("START_LINE"));
    assert.ok(truncated.includes("END_LINE"));
    assert.ok(truncated.includes("characters omitted"));
  });

  // 8. Validation Engine Impact Analysis
  await t.test("ValidationEngine analyzes breaking change risk based on callers count", async () => {
    const engine = new ValidationEngine();
    assert.equal(engine.shouldRunTypecheck(["src/index.ts"]), true);
    assert.equal(engine.shouldRunTypecheck(["README.md", "image.png"]), false);
  });

  // 9. Large File Reading by Line Range (e.g. 26,000 lines, > 1MB)
  await t.test("readTextFileLineRange accurately slices lines in large files without loading entire file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooshyar-test-large-"));
    const filePath = path.join(tmpDir, "helpers.py");

    // Generate 26,000 lines (> 1.1 MB)
    const lineCount = 26000;
    const writeStream = fs.createWriteStream(filePath, { encoding: "utf-8" });
    for (let i = 1; i <= lineCount; i++) {
      writeStream.write(`def helper_func_${i}():\n    return ${i} * 42\n`);
    }
    await new Promise((resolve) => writeStream.end(resolve));

    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 1_000_000, `File size should exceed 1MB, got ${stat.size}`);

    const fileUri = vscode.Uri.file(filePath);

    // Test slice 1: lines 18080 to 18360 (281 lines)
    const slice1 = await readTextFileLineRange(fileUri, 18080, 18360);
    assert.equal(slice1.start, 18080);
    assert.equal(slice1.end, 18360);
    assert.equal(slice1.lines.length, 281);
    assert.equal(slice1.totalLines, 52000); // 26000 * 2 lines

    // Test slice 2: lines 25080 to 25790 (711 lines)
    const slice2 = await readTextFileLineRange(fileUri, 25080, 25790);
    assert.equal(slice2.start, 25080);
    assert.equal(slice2.end, 25790);
    assert.equal(slice2.lines.length, 711);

    // Test without range on large file: returns first 350 lines with isTruncated = true
    const defaultSlice = await readTextFileLineRange(fileUri);
    assert.equal(defaultSlice.lines.length, 350);
    assert.equal(defaultSlice.isTruncated, true);

    // Test readFileTool with workspace folder
    vscode.workspace.workspaceFolders.push({ name: "tmp", index: 0, uri: vscode.Uri.file(tmpDir) });
    try {
      const toolOutput = await readFileTool({
        path: "helpers.py",
        start_line: 18080,
        end_line: 18360
      });
      assert.ok(toolOutput.includes("=== File: helpers.py (Lines 18080 to 18360"));
      assert.ok(!toolOutput.includes("File exceeds max size"));

      // Call without range: returns pagination message without error
      const paginatedOutput = await readFileTool({ path: "helpers.py" });
      assert.ok(paginatedOutput.includes("Showing lines 1 to 350"));
      assert.ok(paginatedOutput.includes("File truncated"));
      assert.ok(!paginatedOutput.includes("File exceeds max size"));
    } finally {
      vscode.workspace.workspaceFolders.pop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 10. Folder Attachments and Drag-Drop / Paste handling
  await t.test("ChatViewProvider supports folder attachments and file:// URI drops", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooshyar-test-folder-"));
    const subDir = path.join(tmpDir, "utils");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "helper.ts"), "export const pi = 3.14;");
    fs.writeFileSync(path.join(subDir, "calc.ts"), "export function add(a, b) { return a + b; }");

    // Create node_modules to verify it is excluded
    const nodeModules = path.join(subDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    fs.writeFileSync(path.join(nodeModules, "pkg.js"), "console.log('ignored');");

    const mockSecretStorage = { get: async () => null, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose: () => {} }) };
    const mockMemento = { get: (k, def) => def ?? [], update: async () => {}, keys: () => [] };

    const provider = new ChatViewProvider(vscode.Uri.file(tmpDir), mockSecretStorage, mockMemento);
    try {
      // 1. Attach folder
      await provider.addUriToChat(vscode.Uri.file(subDir));
      const attachments = provider.getPendingAttachments();
      assert.equal(attachments.length, 1);
      assert.ok(attachments[0].path.includes("utils"));
      assert.ok(attachments[0].path.includes("2 files"));
      assert.ok(attachments[0].content.includes("helper.ts"));
      assert.ok(attachments[0].content.includes("calc.ts"));
      assert.ok(!attachments[0].content.includes("pkg.js")); // node_modules ignored

      // 2. Drag & Drop file:// URI
      const fileUri = vscode.Uri.file(path.join(subDir, "helper.ts"));
      await provider.addUriToChat(fileUri);
      const updated = provider.getPendingAttachments();
      assert.equal(updated.length, 2);
    } finally {
      provider.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
