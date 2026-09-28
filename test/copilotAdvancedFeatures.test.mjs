import test from "node:test";
import assert from "node:assert/strict";
import { MemoryManager } from "../out/memoryManager.js";
import {
  getWorkspaceSymbolsTool,
  getDiagnosticsTool,
  cleanHtmlToMarkdown,
  fetchWebpageTool,
  manageMemoryTool,
  buildToolDefinitions,
  assertSafeCommand,
  runInTerminalTool,
  isMutatingTool,
  isParallelSafeTool,
  resolveCommandTimeoutMs
} from "../out/tools.js";
import { collectRuleFiles } from "../out/rulesLoader.js";
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";

test("Advanced Copilot Parity Features Tests", async (t) => {
  await t.test("MemoryManager store, recall, list, delete, and formatForSystemPrompt", async () => {
    const memory = MemoryManager.getInstance();
    await memory.clear();

    assert.equal(memory.formatForSystemPrompt(), "");
    assert.deepEqual(memory.list(), {});

    await memory.store("preferredLanguage", "TypeScript");
    await memory.store("testFramework", "node:test");

    assert.equal(memory.recall("preferredLanguage"), "TypeScript");
    assert.equal(memory.recall("testFramework"), "node:test");
    assert.equal(memory.recall("nonexistent"), undefined);

    const list = memory.list();
    assert.equal(list.preferredLanguage, "TypeScript");
    assert.equal(list.testFramework, "node:test");

    const promptText = memory.formatForSystemPrompt();
    assert.ok(promptText.includes("DEVELOPER PERSISTENT PREFERENCES"));
    assert.ok(promptText.includes("preferredLanguage"));
    assert.ok(promptText.includes("TypeScript"));

    const deleted = await memory.delete("testFramework");
    assert.equal(deleted, true);
    assert.equal(memory.recall("testFramework"), undefined);

    let changeCount = 0;
    const sub = memory.onDidChange(() => {
      changeCount++;
    });

    await memory.store("tempKey", "tempVal");
    assert.equal(changeCount, 1);

    await memory.delete("tempKey");
    assert.equal(changeCount, 2);

    await memory.clear();
    assert.equal(changeCount, 3);
    assert.equal(memory.formatForSystemPrompt(), "");

    sub.dispose();
  });

  await t.test("cleanHtmlToMarkdown converts HTML to clean readable text", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>alert('xss');</script>
        </head>
        <body>
          <h1>Documentation Title</h1>
          <p>This is a paragraph with <a href="https://example.com/api">API Docs</a> link.</p>
          <h2>Subheading</h2>
          <pre><code>const a = 1;</code></pre>
        </body>
      </html>
    `;

    const md = cleanHtmlToMarkdown(html);
    assert.ok(!md.includes("alert"));
    assert.ok(!md.includes("color: red"));
    assert.ok(md.includes("# Documentation Title"));
    assert.ok(md.includes("## Subheading"));
    assert.ok(md.includes("[API Docs](https://example.com/api)"));
    assert.ok(md.includes("const a = 1;"));
  });

  await t.test("getWorkspaceSymbolsTool returns formatted symbol locations", async () => {
    const result = await getWorkspaceSymbolsTool({ query: "User" });
    assert.ok(result.includes("UserService"));
    assert.ok(result.includes("/workspace/src/auth.ts"));
  });

  await t.test("getDiagnosticsTool formats compiler and linter diagnostics", async () => {
    const result = await getDiagnosticsTool({ severity: "all" });
    assert.ok(result.includes("Diagnostics (1 item(s))"));
    assert.ok(result.includes("Cannot find module 'express'"));
    assert.ok(result.includes("[ERROR]"));
    assert.ok(result.includes("index.ts"));
  });

  await t.test("manageMemoryTool operates store, recall, list, and delete actions", async () => {
    const memory = MemoryManager.getInstance();
    await memory.clear();

    const storeRes = await manageMemoryTool({
      action: "store",
      key: "userStyle",
      value: "Functional programming"
    });
    assert.ok(storeRes.includes("Stored preference for"));

    const recallRes = await manageMemoryTool({
      action: "recall",
      key: "userStyle"
    });
    assert.ok(recallRes.includes("Functional programming"));

    const listRes = await manageMemoryTool({ action: "list" });
    assert.ok(listRes.includes("userStyle"));

    const delRes = await manageMemoryTool({
      action: "delete",
      key: "userStyle"
    });
    assert.ok(delRes.includes("Deleted"));
  });

  await t.test("buildToolDefinitions includes all 4 new Copilot tools", () => {
    const tools = buildToolDefinitions({ enableShellTool: true });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("get_workspace_symbols"));
    assert.ok(names.includes("get_diagnostics"));
    assert.ok(names.includes("fetch_webpage"));
    assert.ok(names.includes("manage_memory"));
  });

  await t.test("fetchWebpageTool routes private Figma links to MCP", async () => {
    await assert.rejects(
      () => fetchWebpageTool({ url: "https://www.figma.com/design/file-key/Test?node-id=0-1" }),
      /mcp_figma_/i
    );
  });

  await t.test("rulesLoader collects copilot-instructions.md, AGENTS.md and CLAUDE.md", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "hooshyar-test-"));
    try {
      const githubDir = path.join(tempDir, ".github");
      await fsPromises.mkdir(githubDir, { recursive: true });
      await fsPromises.writeFile(path.join(githubDir, "copilot-instructions.md"), "# Copilot rule");
      await fsPromises.writeFile(path.join(tempDir, "AGENTS.md"), "# Agents rule");
      await fsPromises.writeFile(path.join(tempDir, "CLAUDE.md"), "# Claude rule");

      const collected = await collectRuleFiles(tempDir);
      assert.ok(collected.some((f) => f.includes("copilot-instructions.md")));
      assert.ok(collected.some((f) => f.includes("AGENTS.md")));
      assert.ok(collected.some((f) => f.includes("CLAUDE.md")));
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test("assertSafeCommand allows test commands and safe chaining with &&", () => {
    assert.doesNotThrow(() => assertSafeCommand("npm test"));
    assert.doesNotThrow(() => assertSafeCommand("npm run test:unit"));
    assert.doesNotThrow(() => assertSafeCommand("pytest tests/"));
    assert.doesNotThrow(() => assertSafeCommand("cargo test --all"));
    assert.doesNotThrow(() => assertSafeCommand("npm run compile && npm test"));
  });

  await t.test("assertSafeCommand blocks dangerous commands and operators", () => {
    assert.throws(() => assertSafeCommand("npm test; rm -rf /"));
    assert.throws(() => assertSafeCommand("rm -rf node_modules"));
    assert.throws(() => assertSafeCommand("cat file | bash"));
    assert.throws(() => assertSafeCommand("npm test & echo background"));
  });

  await t.test("runInTerminalTool sends command to terminal and returns confirmation", async () => {
    const res = await runInTerminalTool({ command: "npm test" });
    assert.ok(res.includes("Successfully sent command to Hooshyar Terminal"));
    assert.ok(res.includes("npm test"));
  });

  await t.test("isMutatingTool flags run_in_terminal and run_command as mutating", () => {
    assert.equal(isMutatingTool("run_in_terminal"), true);
    assert.equal(isMutatingTool("run_command"), true);
    assert.equal(isMutatingTool("read_file"), false);
  });

  await t.test("only independent read tools are eligible for parallel execution", () => {
    assert.equal(isParallelSafeTool("read_file"), true);
    assert.equal(isParallelSafeTool("search_codebase"), true);
    assert.equal(isParallelSafeTool("update_tasks"), false);
    assert.equal(isParallelSafeTool("manage_memory"), false);
    assert.equal(isParallelSafeTool("list_codebase"), false);
    assert.equal(isParallelSafeTool("mcp_figma_get_file"), false);
    assert.equal(isParallelSafeTool("task_complete"), false);
  });

  await t.test("command timeout is normalized to safe bounds", () => {
    assert.equal(resolveCommandTimeoutMs(500), 1000);
    assert.equal(resolveCommandTimeoutMs(45_000), 45_000);
    assert.equal(resolveCommandTimeoutMs(900_000), 600_000);
  });

  await t.test("assertSafeCommand allows PowerShell environment variables without throwing", () => {
    assert.doesNotThrow(() => assertSafeCommand("echo $env:NODE_ENV"));
    assert.doesNotThrow(() => assertSafeCommand("node -e 'console.log($myVar)'"));
  });

  await t.test("buildToolDefinitions includes run_command and run_in_terminal when enableShellTool is true", () => {
    const tools = buildToolDefinitions({ enableShellTool: true });
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("run_command"));
    assert.ok(names.includes("run_in_terminal"));
    assert.ok(names.includes("task_complete"));
    const runCommand = tools.find((tool) => tool.name === "run_command");
    assert.ok(runCommand.input_schema.properties.timeout_ms);
  });
});
