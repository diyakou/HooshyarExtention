/**
 * Symbol-First Retrieval Tools
 *
 * Implements granular code intelligence tools that retrieve symbols, outlines,
 * callers, dependencies, related tests, and project maps rather than dumping
 * entire files into LLM context.
 */

import { CodebaseIntelligence } from "./codebaseIntelligence";
import { getIncrementalIndexer } from "./incrementalIndexer";

export interface GetSymbolInput {
  /** Symbol name (e.g. "AuthService.login", "AuthService", "login") */
  symbol?: string;
  /** Optional file path to disambiguate or search directly */
  path?: string;
  /** Optional line number if path is given */
  line?: number;
}

/**
 * get_symbol: Retrieves targeted symbol code range and key architectural metadata
 * (callers, dependencies, related tests) without loading the entire file.
 */
export async function getSymbolTool(input: GetSymbolInput): Promise<string> {
  const query = (input.symbol || "").trim();
  const filePath = (input.path || "").trim();
  const intelligence = CodebaseIntelligence.getCodebaseIntelligence();

  if (!query && !filePath) {
    throw new Error("get_symbol requires at least 'symbol' or 'path'.");
  }

  // Case 1: Path and line are provided -> locate symbol at location
  if (filePath && typeof input.line === "number") {
    const sym = await intelligence.getSymbolAtLocation(filePath, input.line - 1);
    if (sym) {
      return formatSymbolResult(sym, intelligence);
    }
  }

  // Case 2: File path provided -> look in file outline
  if (filePath) {
    try {
      const outline = await intelligence.getFileOutline(filePath);
      if (query) {
        // Find best match in outline
        const match = outline.symbols.find(
          (s) => s.name.toLowerCase() === query.toLowerCase() ||
                 (s.containerName && `${s.containerName}.${s.name}`.toLowerCase() === query.toLowerCase()) ||
                 s.name.toLowerCase().endsWith(query.toLowerCase())
        );
        if (match) {
          return formatSymbolResult(match, intelligence);
        }
      } else if (outline.symbols.length > 0) {
        // Return first primary symbol
        return formatSymbolResult(outline.symbols[0], intelligence);
      }
    } catch {
      // Fall through to workspace symbol search
    }
  }

  // Case 3: Workspace symbol search by name
  if (query) {
    // Handle container.method syntax (e.g. "AuthService.login")
    const parts = query.split(".");
    const searchName = parts[parts.length - 1];
    const containerFilter = parts.length > 1 ? parts[0].toLowerCase() : undefined;

    const symbols = await intelligence.findSymbol(searchName);
    if (symbols.length === 0) {
      return `Symbol '${query}' not found. Consider using 'find_symbol' for substring search or 'get_file_outline' for the target file.`;
    }

    let targetSym = symbols[0];
    if (containerFilter) {
      const matched = symbols.find(
        (s) => (s.containerName && s.containerName.toLowerCase().includes(containerFilter)) ||
               s.file.toLowerCase().includes(containerFilter)
      );
      if (matched) targetSym = matched;
    }

    return formatSymbolResult(targetSym, intelligence);
  }

  return `Symbol '${query || filePath}' not found.`;
}

async function formatSymbolResult(
  sym: { name: string; kind: string; file: string; startLine: number; endLine: number; containerName?: string },
  intelligence: CodebaseIntelligence
): Promise<string> {
  const code = await intelligence.getSymbolCode(sym.file, sym.startLine, sym.endLine);

  // Retrieve dependencies and callers concurrently
  const midLine = Math.floor((sym.startLine + sym.endLine) / 2);
  const [callers, dependencies, relatedTests] = await Promise.all([
    intelligence.findCallers(sym.file, sym.startLine, 0).catch(() => []),
    intelligence.findDependencies(sym.file, midLine, 0).catch(() => []),
    intelligence.findRelatedTests(sym.file).catch(() => [])
  ]);

  const qualifiedName = sym.containerName ? `${sym.containerName}.${sym.name}` : sym.name;
  const lines: string[] = [
    `Symbol: ${qualifiedName}`,
    `Kind: ${sym.kind}`,
    `File: ${sym.file}`,
    `Range: ${sym.startLine + 1}-${sym.endLine + 1}`
  ];

  if (dependencies.length > 0) {
    lines.push("\nDependencies:");
    for (const dep of dependencies.slice(0, 10)) {
      lines.push(`- ${dep.name} (${dep.file}:${dep.startLine + 1})`);
    }
  }

  if (callers.length > 0) {
    lines.push("\nCalled By:");
    for (const caller of callers.slice(0, 10)) {
      lines.push(`- ${caller.name} (${caller.file}:${caller.startLine + 1})`);
    }
  }

  if (relatedTests.length > 0) {
    lines.push("\nTests:");
    for (const t of relatedTests.slice(0, 5)) {
      lines.push(`- ${t}`);
    }
  }

  lines.push("\nCode:");
  lines.push("```" + getLanguageForFile(sym.file));
  lines.push(code || "(code range could not be read)");
  lines.push("```");

  return lines.join("\n");
}

/**
 * get_file_outline: Returns the structural outline of a file without reading the whole body.
 */
export async function getFileOutlineTool(input: { path?: string }): Promise<string> {
  const filePath = (input.path || "").trim();
  if (!filePath) throw new Error("get_file_outline requires 'path'.");

  const intelligence = CodebaseIntelligence.getCodebaseIntelligence();
  const outline = await intelligence.getFileOutline(filePath);

  const lines: string[] = [
    `Outline for ${outline.file}:`,
    `Total Symbols: ${outline.symbols.length}`
  ];

  if (outline.imports.length > 0) {
    lines.push("\nImports:");
    for (const imp of outline.imports.slice(0, 15)) {
      lines.push(`- ${imp}`);
    }
    if (outline.imports.length > 15) {
      lines.push(`  ... and ${outline.imports.length - 15} more`);
    }
  }

  if (outline.exports.length > 0) {
    lines.push("\nExports:");
    for (const exp of outline.exports) {
      lines.push(`- ${exp}`);
    }
  }

  if (outline.symbols.length > 0) {
    lines.push("\nSymbols:");
    for (const sym of outline.symbols) {
      const container = sym.containerName ? ` [${sym.containerName}]` : "";
      lines.push(`- ${sym.kind} ${sym.name}${container} (lines ${sym.startLine + 1}-${sym.endLine + 1})`);
    }
  } else {
    lines.push("\n(No symbols detected in file outline)");
  }

  return lines.join("\n");
}

/**
 * find_callers: Find incoming callers for a function or method.
 */
export async function findCallersTool(input: {
  path?: string;
  line?: number;
  character?: number;
  symbol?: string;
}): Promise<string> {
  const intelligence = CodebaseIntelligence.getCodebaseIntelligence();
  let targetFile = (input.path || "").trim();
  let targetLine = typeof input.line === "number" ? input.line - 1 : 0;
  const targetChar = typeof input.character === "number" ? input.character - 1 : 0;

  if (input.symbol && !targetFile) {
    const symbols = await intelligence.findSymbol(input.symbol);
    if (symbols.length > 0) {
      targetFile = symbols[0].file;
      targetLine = symbols[0].startLine;
    } else {
      return `Symbol '${input.symbol}' not found.`;
    }
  }

  if (!targetFile) {
    throw new Error("find_callers requires either 'path' with 'line', or 'symbol'.");
  }

  const callers = await intelligence.findCallers(targetFile, targetLine, targetChar);
  if (callers.length === 0) {
    return `No callers found for ${targetFile}:${targetLine + 1}.`;
  }

  const lines = [
    `Callers for ${targetFile}:${targetLine + 1} (${callers.length}):`,
    ...callers.map((c) => `- ${c.name} (${c.file}:${c.startLine + 1})`)
  ];
  return lines.join("\n");
}

/**
 * find_dependencies: Find outgoing dependencies/definitions for a code location.
 */
export async function findDependenciesTool(input: {
  path?: string;
  line?: number;
  character?: number;
  symbol?: string;
}): Promise<string> {
  const intelligence = CodebaseIntelligence.getCodebaseIntelligence();
  let targetFile = (input.path || "").trim();
  let targetLine = typeof input.line === "number" ? input.line - 1 : 0;
  const targetChar = typeof input.character === "number" ? input.character - 1 : 0;

  if (input.symbol && !targetFile) {
    const symbols = await intelligence.findSymbol(input.symbol);
    if (symbols.length > 0) {
      targetFile = symbols[0].file;
      targetLine = symbols[0].startLine;
    } else {
      return `Symbol '${input.symbol}' not found.`;
    }
  }

  if (!targetFile) {
    throw new Error("find_dependencies requires either 'path' with 'line', or 'symbol'.");
  }

  const deps = await intelligence.findDependencies(targetFile, targetLine, targetChar);
  if (deps.length === 0) {
    return `No direct dependencies found for ${targetFile}:${targetLine + 1}.`;
  }

  const lines = [
    `Dependencies for ${targetFile}:${targetLine + 1} (${deps.length}):`,
    ...deps.map((d) => `- ${d.name} (${d.file}:${d.startLine + 1})`)
  ];
  return lines.join("\n");
}

/**
 * get_related_tests: Find unit/integration test files related to a source file.
 */
export async function getRelatedTestsTool(input: { path?: string }): Promise<string> {
  const filePath = (input.path || "").trim();
  if (!filePath) throw new Error("get_related_tests requires 'path'.");

  const intelligence = CodebaseIntelligence.getCodebaseIntelligence();
  const tests = await intelligence.findRelatedTests(filePath);

  if (tests.length === 0) {
    return `No related test files found for ${filePath}.`;
  }

  return `Related tests for ${filePath} (${tests.length}):\n${tests.map((t) => `- ${t}`).join("\n")}`;
}

/**
 * get_project_map: Returns a compact hierarchy of directories and files with symbol counts.
 */
export async function getProjectMapTool(input?: { maxDepth?: number }): Promise<string> {
  const indexer = getIncrementalIndexer();
  const map = indexer.getProjectMap(input?.maxDepth ?? 3);
  return map || "Project map unavailable. Workspace may be empty or unindexed.";
}

function getLanguageForFile(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": return "typescript";
    case "tsx": return "typescriptreact";
    case "js": return "javascript";
    case "jsx": return "javascriptreact";
    case "py": return "python";
    case "java": return "java";
    case "go": return "go";
    case "rs": return "rust";
    case "cs": return "csharp";
    case "php": return "php";
    default: return "";
  }
}
