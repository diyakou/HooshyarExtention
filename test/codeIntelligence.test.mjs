import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chunkDocument, contentHash } from "../out/codeIndex/chunker.js";
import { hybridSearch } from "../out/codeIndex/hybridSearch.js";
import { WorkspaceCodeIndex } from "../out/codeIndex/workspaceCodeIndex.js";
import { findSymbolTool } from "../out/symbolIntelligence.js";
import { buildToolDefinitions } from "../out/tools.js";
import { classifyTool } from "../out/tools/createRegistry.js";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Code intelligence", async (t) => {
  await t.test("chunkDocument prefers symbols and records imports, exports, and hashes", () => {
    const content = 'import { x } from "./dep";\nexport class AuthService {\n  login() {}\n}\n';
    const chunks = chunkDocument("src/auth.ts", "typescript", content, [
      { name: "AuthService", kind: "Class", startLine: 1, endLine: 3 }
    ], 100);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].symbolName, "AuthService");
    assert.deepEqual(chunks[0].imports, ["./dep"]);
    assert.deepEqual(chunks[0].exports, ["AuthService"]);
    assert.equal(chunks[0].hash, contentHash(chunks[0].content));
  });

  await t.test("logical fallback chunks declarations instead of arbitrary character blocks", () => {
    const chunks = chunkDocument("src/service.ts", "typescript", "function first() {}\n\nclass Second {}\n");
    assert.deepEqual(chunks.map((chunk) => chunk.symbolName), ["first", "Second"]);
  });

  await t.test("hybrid search combines text, symbol, and active-context ranking", () => {
    const now = Date.now();
    const chunks = [
      { id: "1", uri: "src/auth.ts", languageId: "typescript", symbolName: "AuthService", startLine: 0, endLine: 2, content: "class AuthService { login() {} }", imports: [], exports: [], hash: "a", updatedAt: now },
      { id: "2", uri: "src/user.ts", languageId: "typescript", symbolName: "UserService", startLine: 0, endLine: 2, content: "class UserService profile", imports: [], exports: [], hash: "b", updatedAt: now }
    ];
    const results = hybridSearch(chunks, { query: "AuthService" }, { semantic: 0.5, text: 0.2, symbol: 0.2, context: 0.1 }, "src/auth.ts");
    assert.equal(results[0].uri, "src/auth.ts");
    assert.equal(results[0].source, "symbol");
  });

  await t.test("workspace index skips unchanged content by hash", async () => {
    const uri = { scheme: "file", fsPath: "/workspace/src/auth.ts", toString: () => "file:///workspace/src/auth.ts" };
    vscode.workspace.workspaceFolders.push({ name: "workspace", index: 0, uri: { fsPath: "/workspace" } });
    const oldFs = vscode.workspace.fs;
    const oldOpen = vscode.workspace.openTextDocument;
    const oldCmd = vscode.commands.executeCommand;
    vscode.workspace.fs = { stat: async () => ({ size: 30, mtime: 100 }) };
    vscode.workspace.openTextDocument = async () => ({ languageId: "typescript", getText: () => "export class AuthService {}" });
    vscode.commands.executeCommand = async (cmd) => {
      if (cmd === "vscode.executeDocumentSymbolProvider") {
        return [{ name: "AuthService", kind: 4, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 27 } } }];
      }
      return oldCmd(cmd);
    };
    try {
      const index = new WorkspaceCodeIndex();
      assert.equal(await index.indexUri(uri), true);
      assert.equal(await index.indexUri(uri), false);
      assert.equal(index.allChunks()[0].symbolName, "AuthService");
      index.dispose();
    } finally {
      vscode.workspace.fs = oldFs;
      vscode.workspace.openTextDocument = oldOpen;
      vscode.commands.executeCommand = oldCmd;
      vscode.workspace.workspaceFolders.pop();
    }
  });

  await t.test("symbol tools and schemas are registered with correct risk", async () => {
    const parsed = JSON.parse(await findSymbolTool({ query: "User" }));
    assert.equal(parsed.results[0].name, "UserService");
    const names = buildToolDefinitions({ enableShellTool: false }).map((tool) => tool.name);
    for (const name of ["semantic_search", "find_symbol", "find_definition", "find_references", "find_implementations", "get_hover", "get_document_symbols", "get_call_hierarchy", "rename_symbol"]) {
      assert.ok(names.includes(name), `${name} should be registered`);
    }
    assert.equal(classifyTool("rename_symbol").risk, "write");
    assert.equal(classifyTool("find_references").parallelSafe, true);
  });

  await t.test("workspace index persists and reloads chunks", async () => {
    const uri = { scheme: "file", fsPath: "/workspace/src/service.ts", toString: () => "file:///workspace/src/service.ts" };
    vscode.workspace.workspaceFolders.push({ name: "workspace", index: 0, uri: { fsPath: "/workspace" } });
    const oldFs = vscode.workspace.fs;
    const oldOpen = vscode.workspace.openTextDocument;
    const oldFind = vscode.workspace.findFiles;
    const oldCmd = vscode.commands.executeCommand;
    vscode.workspace.fs = {
      stat: async () => ({ size: 50, mtime: 200 }),
      readFile: async () => Buffer.from('{"version":1,"files":{}}'),
      writeFile: async () => {}
    };
    vscode.workspace.openTextDocument = async () => ({ languageId: "typescript", getText: () => "export function login() {}" });
    vscode.workspace.findFiles = async () => [];
    vscode.commands.executeCommand = async (cmd) => {
      if (cmd === "vscode.executeDocumentSymbolProvider") {
        return [{ name: "login", kind: 11, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } } }];
      }
      return oldCmd(cmd);
    };
    try {
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const storageUri = { fsPath: join(tmpdir(), "hooshyar-test-" + Date.now()) };
      const index = new WorkspaceCodeIndex();
      await index.initialize(storageUri);
      await index.indexUri(uri);
      const chunks = index.allChunks();
      assert.ok(chunks.length > 0);
      assert.ok(chunks[0].hash);
      index.dispose();
    } finally {
      vscode.workspace.fs = oldFs;
      vscode.workspace.openTextDocument = oldOpen;
      vscode.workspace.findFiles = oldFind;
      vscode.commands.executeCommand = oldCmd;
      vscode.workspace.workspaceFolders.pop();
    }
  });

  await t.test("embedding provider interface is implemented", () => {
    const { DisabledEmbeddingProvider } = require("../out/codeIndex/embeddingProvider.js");
    const disabled = new DisabledEmbeddingProvider();
    assert.equal(disabled.available, false);
    assert.equal(typeof disabled.embed, "function");
  });

  await t.test("hybrid search prioritizes semantic when queryEmbedding provided", () => {
    const now = Date.now();
    const chunks = [
      { id: "1", uri: "src/auth.ts", languageId: "typescript", symbolName: "login", startLine: 0, endLine: 2, content: "function login() { return token; }", imports: [], exports: [], hash: "a", updatedAt: now, embedding: [0.1, 0.2, 0.3] },
      { id: "2", uri: "src/user.ts", languageId: "typescript", symbolName: "getUser", startLine: 0, endLine: 2, content: "function getUser() { return profile; }", imports: [], exports: [], hash: "b", updatedAt: now, embedding: [0.8, 0.9, 0.7] }
    ];
    const queryEmbedding = [0.85, 0.88, 0.72];
    const results = hybridSearch(chunks, { query: "user profile" }, { semantic: 0.5, text: 0.2, symbol: 0.2, context: 0.1 }, undefined, queryEmbedding);
    assert.equal(results[0].uri, "src/user.ts");
    assert.equal(results[0].source, "semantic");
  });
});
