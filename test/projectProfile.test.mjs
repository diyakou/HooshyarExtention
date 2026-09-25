import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vscode = require("vscode");

test("Project Profile & Code Graph", async (t) => {
  await t.test("tech stack detector identifies frameworks from package.json", async () => {
    const { detectTechStack } = await import("../out/projectProfile/techStackDetector.js");

    // Mock package.json exists
    vscode.workspace.fs.readFile = async (uri) => {
      if (uri.fsPath.endsWith("package.json")) {
        return Buffer.from(JSON.stringify({
          dependencies: { react: "^18.0.0", express: "^4.18.0" },
          devDependencies: { jest: "^29.0.0", typescript: "^5.0.0" }
        }));
      }
      throw new Error("File not found");
    };

    vscode.workspace.fs.stat = async (uri) => {
      if (uri.fsPath.endsWith("pnpm-lock.yaml")) throw new Error("Not found");
      if (uri.fsPath.endsWith("yarn.lock")) throw new Error("Not found");
      return { type: 2 };
    };

    const result = await detectTechStack("/test/workspace");
    assert.ok(result.frameworks.includes("React"));
    assert.ok(result.frameworks.includes("Express"));
    assert.ok(result.testFrameworks.includes("Jest"));
    assert.ok(result.buildTools.includes("TypeScript"));
    assert.equal(result.packageManager, "npm");
  });

  await t.test("conventions extractor detects indentation and quotes", async () => {
    const { extractConventions } = await import("../out/projectProfile/conventionsExtractor.js");

    vscode.workspace.findFiles = async () => [
      { fsPath: "/test/file1.ts" },
      { fsPath: "/test/file2.ts" }
    ];

    vscode.workspace.fs.readFile = async () => {
      return Buffer.from(`function hello() {\n  const name = "World";\n  return name;\n}\n`);
    };

    const result = await extractConventions("/test/workspace");
    assert.equal(result.indentation, "spaces");
    assert.equal(result.spacing, 2);
    assert.equal(result.quotes, "double");
    assert.equal(result.naming.functions, "camelCase");
  });

  await t.test("dependency analyzer parses package.json dependencies", async () => {
    const { analyzeDependencies } = await import("../out/projectProfile/dependencyAnalyzer.js");

    vscode.workspace.fs.readFile = async (uri) => {
      if (uri.fsPath.endsWith("package.json")) {
        return Buffer.from(JSON.stringify({
          dependencies: { lodash: "^4.17.21" },
          devDependencies: { eslint: "^8.0.0" }
        }));
      }
      throw new Error("Not found");
    };

    const result = await analyzeDependencies("/test/workspace");
    assert.equal(result.runtime.length, 1);
    assert.equal(result.runtime[0].name, "lodash");
    assert.equal(result.dev.length, 1);
    assert.equal(result.dev[0].name, "eslint");
  });

  await t.test("code graph tracks imports and relationships", async () => {
    const { CodeGraph } = await import("../out/codeIndex/codeGraph.js");

    const graph = new CodeGraph();

    graph.addNode({
      uri: "src/main.ts",
      symbolName: "main",
      kind: "Function",
      imports: ["./utils", "./config"],
      exports: [],
      references: [],
      callers: [],
      callees: []
    });

    graph.addNode({
      uri: "src/utils.ts",
      symbolName: "helper",
      kind: "Function",
      imports: [],
      exports: [],
      references: [],
      callers: [],
      callees: []
    });

    graph.addEdge({ from: "src/main.ts", to: "./utils", type: "import" });
    graph.addEdge({ from: "src/main.ts:main", to: "src/utils.ts:helper", type: "call" });

    const related = graph.getRelatedFiles("src/main.ts");
    assert.ok(related.includes("./utils"));

    const deps = graph.getSymbolDependencies("src/main.ts", "main");
    assert.equal(deps.length, 1);
    assert.ok(deps[0].includes("helper"));
  });

  await t.test("code graph tools return properly formatted JSON", async () => {
    const { getRelatedFilesTool, getSymbolDependenciesTool } = await import("../out/codeIndex/codeGraphTools.js");
    const { CodeGraph, getCodeGraph } = await import("../out/codeIndex/codeGraph.js");

    const graph = getCodeGraph();
    graph.clear();

    graph.addNode({
      uri: "src/app.ts",
      symbolName: "App",
      kind: "Class",
      imports: ["./service"],
      exports: [],
      references: [],
      callers: [],
      callees: []
    });

    graph.addEdge({ from: "src/app.ts", to: "./service", type: "import" });

    const relatedResult = await getRelatedFilesTool({ path: "src/app.ts", maxResults: 5 });
    const relatedParsed = JSON.parse(relatedResult);
    assert.equal(relatedParsed.file, "src/app.ts");
    assert.ok(Array.isArray(relatedParsed.relatedFiles));

    const depsResult = await getSymbolDependenciesTool({ path: "src/app.ts", symbol: "App" });
    const depsParsed = JSON.parse(depsResult);
    assert.equal(depsParsed.symbol, "src/app.ts:App");
    assert.ok(Array.isArray(depsParsed.dependencies));
  });
});
