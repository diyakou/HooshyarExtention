import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { expandQuery, hybridSearch } from "../out/codeIndex/hybridSearch.js";
import { CodeGraph } from "../out/codeIndex/codeGraph.js";
import { createIsolatedAgentContext } from "../out/agent/contextIsolation.js";
import { ChangeSetManager } from "../out/changeSet/changeSetManager.js";
import { buildToolDefinitions } from "../out/tools.js";
import { TestResultParser } from "../out/testing/testResultParser.js";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Phases 3-6 integration units", async (t) => {
  await t.test("hybrid retrieval expands known query terms and ranks BM25 matches", () => {
    assert.ok(expandQuery(["auth"]).includes("authentication"));
    const now = Date.now();
    const results = hybridSearch([
      { id: "1", uri: "src/auth.ts", languageId: "typescript", startLine: 0, endLine: 1, content: "function authenticationToken() {}", imports: [], exports: [], hash: "1", updatedAt: now },
      { id: "2", uri: "src/menu.ts", languageId: "typescript", startLine: 0, endLine: 1, content: "function openMenu() {}", imports: [], exports: [], hash: "2", updatedAt: now }
    ], { query: "auth" }, { semantic: 0, text: 1, symbol: 0, context: 0 });
    assert.equal(results[0].uri, "src/auth.ts");
  });

  await t.test("code graph normalizes paths and accepts legacy symbol endpoints", () => {
    const graph = new CodeGraph();
    graph.addNode({ uri: "src/main.ts", symbolName: "main", kind: "Function", imports: [], exports: [], references: [], callers: [], callees: [] });
    graph.addNode({ uri: "src/utils.ts", symbolName: "helper", kind: "Function", imports: [], exports: [], references: [], callers: [], callees: [] });
    graph.addEdge({ from: "src/main.ts", to: "src/utils.ts", type: "import" });
    graph.addEdge({ from: "src/main.ts:main", to: "src/utils.ts:helper", type: "call" });
    assert.deepEqual(graph.getRelatedFiles("src/main.ts"), ["src/utils.ts"]);
    assert.equal(graph.getSymbolDependencies("src/main.ts", "main").length, 1);
  });

  await t.test("isolated agent context retains only bounded task data", () => {
    const context = createIsolatedAgentContext({
      goal: "  search auth  ",
      languages: ["TypeScript", "TypeScript", "Python"],
      frameworks: ["React", "React"],
      relatedFiles: ["a.ts", "a.ts", "b.ts"],
      budget: 1
    });
    assert.equal(context.goal, "search auth");
    assert.deepEqual(context.project.languages, ["TypeScript"]);
    assert.deepEqual(context.relatedFiles, ["a.ts"]);
  });

  await t.test("ChangeSet applies atomically and detects concurrent edits", async () => {
    const originalFolders = vscode.workspace.workspaceFolders.splice(0);
    const originalFs = vscode.workspace.fs;
    const files = new Map([["/workspace/a.ts", "before"]]);
    vscode.workspace.workspaceFolders.push({ name: "workspace", index: 0, uri: vscode.Uri.file("/workspace") });
    vscode.workspace.fs = {
      readFile: async (uri) => {
        const key = uri.fsPath.replace(/\\/g, "/");
        if (!files.has(key)) throw new Error("missing");
        return Buffer.from(files.get(key));
      },
      writeFile: async (uri, content) => { files.set(uri.fsPath.replace(/\\/g, "/"), Buffer.from(content).toString("utf8")); },
      delete: async (uri) => { files.delete(uri.fsPath.replace(/\\/g, "/")); },
      createDirectory: async () => {}
    };
    try {
      const manager = new ChangeSetManager();
      const id = manager.createChangeSet("edit a");
      manager.addChange({ path: "a.ts", type: "edit", content: "after", oldContent: "before", hash: ChangeSetManager.hashContent("before") }, id);
      assert.equal(await manager.apply(id), true);
      assert.equal(files.get("/workspace/a.ts"), "after");
      assert.equal(await manager.rollback(id), true);
      assert.equal(files.get("/workspace/a.ts"), "before");

      const conflictId = manager.createChangeSet("conflict");
      manager.addChange({ path: "a.ts", type: "edit", content: "next", oldContent: "before", hash: ChangeSetManager.hashContent("before") }, conflictId);
      files.set("/workspace/a.ts", "user edit");
      assert.equal(await manager.apply(conflictId), false);
      assert.equal(manager.getChangeSet(conflictId)?.state, "conflicted");
    } finally {
      vscode.workspace.fs = originalFs;
      vscode.workspace.workspaceFolders.splice(0, vscode.workspace.workspaceFolders.length, ...originalFolders);
    }
  });

  await t.test("agent and ChangeSet tools are exposed through the registry definitions", () => {
    const names = buildToolDefinitions({ enableShellTool: false }).map((tool) => tool.name);
    for (const name of ["get_related_files", "get_symbol_dependencies", "get_symbol_dependents", "create_plan", "delegate_search", "verify_changes", "apply_changeset"]) {
      assert.ok(names.includes(name), `${name} should be registered`);
    }
  });

  await t.test("test parser produces structured Jest results", () => {
    const parsed = new TestResultParser().parse("Tests: 1 failed, 2 passed, 3 total\nTime: 1.2 s", "jest");
    assert.deepEqual({ total: parsed.totalTests, passed: parsed.passed, failed: parsed.failed, duration: parsed.duration }, { total: 3, passed: 2, failed: 1, duration: 1200 });
  });
});
