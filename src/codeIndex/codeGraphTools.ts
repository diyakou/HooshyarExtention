import * as vscode from "vscode";
import { getCodeGraph, buildCodeGraphForFile } from "../codeIndex/codeGraph";
import { ToolDefinition } from "../types";

export async function getRelatedFilesTool(input: { path: string; maxResults?: number }): Promise<string> {
  const filePath = String(input?.path || "").trim();
  if (!filePath) {
    throw new Error("get_related_files requires 'path'.");
  }

  const graph = getCodeGraph();
  const related = graph.getRelatedFiles(filePath);
  const maxResults = input.maxResults ?? 10;

  return JSON.stringify({
    file: filePath,
    relatedFiles: related.slice(0, maxResults),
    relationshipTypes: ["imports", "references"]
  });
}

export async function getSymbolDependenciesTool(input: { path: string; symbol: string }): Promise<string> {
  const filePath = String(input?.path || "").trim();
  const symbolName = String(input?.symbol || "").trim();

  if (!filePath || !symbolName) {
    throw new Error("get_symbol_dependencies requires 'path' and 'symbol'.");
  }

  const graph = getCodeGraph();
  const dependencies = graph.getSymbolDependencies(filePath, symbolName);

  return JSON.stringify({
    symbol: `${filePath}:${symbolName}`,
    dependencies: dependencies.map(parseSymbolEndpoint)
  });
}

export async function getSymbolDependentsTool(input: { path: string; symbol: string }): Promise<string> {
  const filePath = String(input?.path || "").trim();
  const symbolName = String(input?.symbol || "").trim();

  if (!filePath || !symbolName) {
    throw new Error("get_symbol_dependents requires 'path' and 'symbol'.");
  }

  const graph = getCodeGraph();
  const dependents = graph.getSymbolDependents(filePath, symbolName);

  return JSON.stringify({
    symbol: `${filePath}:${symbolName}`,
    dependents: dependents.map(parseSymbolEndpoint),
    count: dependents.length
  });
}

function parseSymbolEndpoint(endpoint: string): { file: string; symbol?: string } {
  const separator = endpoint.indexOf("\u0000");
  return separator < 0
    ? { file: endpoint }
    : { file: endpoint.slice(0, separator), symbol: endpoint.slice(separator + 1) };
}

export function buildCodeGraphTools(): ToolDefinition[] {
  return [
    {
      name: "get_related_files",
      description: "Find files related to a given file through imports, references, or usage patterns. Returns files that import this file, files this file imports, and files with symbol references.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path to find related files for (workspace-relative or absolute)"
          },
          maxResults: {
            type: "number",
            description: "Maximum number of related files to return (default: 10)"
          }
        },
        required: ["path"]
      }
    },
    {
      name: "get_symbol_dependencies",
      description: "Show what symbols and files a given symbol depends on. Useful for understanding dependencies before refactoring.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path containing the symbol"
          },
          symbol: {
            type: "string",
            description: "The symbol name (class, function, variable, etc.)"
          }
        },
        required: ["path", "symbol"]
      }
    },
    {
      name: "get_symbol_dependents",
      description: "Show what symbols and files depend on a given symbol. Use before modifying or deleting a symbol to understand impact.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path containing the symbol"
          },
          symbol: {
            type: "string",
            description: "The symbol name (class, function, variable, etc.)"
          }
        },
        required: ["path", "symbol"]
      }
    }
  ];
}

// Build code graph incrementally when files are indexed
export async function updateCodeGraphForFile(uri: vscode.Uri): Promise<void> {
  await buildCodeGraphForFile(uri);
}
