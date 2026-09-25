import * as path from "path";
import * as vscode from "vscode";
import { getWorkspaceFolders, isSubpath } from "../workspaceUtils";

export interface CodeGraphNode {
  uri: string;
  symbolName: string;
  kind: string;
  imports: string[];
  exports: string[];
  references: string[];
  callers: string[];
  callees: string[];
}

export interface CodeGraphEdge {
  from: string;
  to: string;
  type: "import" | "reference" | "call" | "inheritance";
}

const SYMBOL_SEPARATOR = "\u0000";

export class CodeGraph {
  private nodes = new Map<string, CodeGraphNode>();
  private edges: CodeGraphEdge[] = [];
  private readonly fileNodes = new Map<string, Set<string>>();

  addNode(node: CodeGraphNode): void {
    const normalized = { ...node, uri: normalizeGraphPath(node.uri) };
    const key = symbolKey(normalized.uri, normalized.symbolName);
    this.nodes.set(key, normalized);
    const keys = this.fileNodes.get(normalized.uri) || new Set<string>();
    keys.add(key);
    this.fileNodes.set(normalized.uri, keys);
  }

  addEdge(edge: CodeGraphEdge): void {
    const normalized = {
      ...edge,
      from: normalizeEdgeEndpoint(edge.from),
      to: normalizeEdgeEndpoint(edge.to)
    };
    if (!this.edges.some((item) => item.from === normalized.from && item.to === normalized.to && item.type === normalized.type)) {
      this.edges.push(normalized);
    }
  }

  replaceFile(filePath: string, nodes: CodeGraphNode[], edges: CodeGraphEdge[]): void {
    const normalizedPath = normalizeGraphPath(filePath);
    this.removeFile(normalizedPath);
    for (const node of nodes) this.addNode({ ...node, uri: normalizedPath });
    for (const edge of edges) this.addEdge(edge);
  }

  removeFile(filePath: string): void {
    const normalizedPath = normalizeGraphPath(filePath);
    const nodeKeys = this.fileNodes.get(normalizedPath) || new Set<string>();
    for (const key of nodeKeys) this.nodes.delete(key);
    this.fileNodes.delete(normalizedPath);
    this.edges = this.edges.filter((edge) => {
      const fromFile = fileFromEndpoint(edge.from);
      const toFile = fileFromEndpoint(edge.to);
      return !sameFile(fromFile, normalizedPath) && !sameFile(toFile, normalizedPath);
    });
  }

  getNode(uri: string, symbolName: string): CodeGraphNode | undefined {
    return this.nodes.get(symbolKey(normalizeGraphPath(uri), symbolName));
  }

  getRelatedFiles(uri: string): string[] {
    const target = normalizeGraphPath(uri);
    const related = new Set<string>();
    for (const edge of this.edges) {
      if (edge.type !== "import" && edge.type !== "reference") continue;
      const fromFile = fileFromEndpoint(edge.from);
      const toFile = fileFromEndpoint(edge.to);
      if (sameFile(toFile, target)) related.add(this.knownFile(toFile));
      if (sameFile(fromFile, target)) related.add(this.knownFile(toFile));
    }
    related.delete(target);
    return [...related].sort();
  }

  getSymbolDependencies(uri: string, symbolName: string): string[] {
    const key = symbolKey(normalizeGraphPath(uri), symbolName);
    return [...new Set(this.edges.filter((edge) => edge.from === key).map((edge) => edge.to))].sort();
  }

  getSymbolDependents(uri: string, symbolName: string): string[] {
    const key = symbolKey(normalizeGraphPath(uri), symbolName);
    return [...new Set(this.edges.filter((edge) => edge.to === key).map((edge) => edge.from))].sort();
  }

  getAllNodes(): CodeGraphNode[] {
    return [...this.nodes.values()];
  }

  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.fileNodes.clear();
  }

  private knownFile(candidate: string): string {
    const normalizedCandidate = normalizeGraphPath(candidate);
    return [...this.fileNodes.keys()].find((file) => sameFile(file, normalizedCandidate)) || normalizedCandidate;
  }
}

let globalGraph: CodeGraph | undefined;

export function getCodeGraph(): CodeGraph {
  globalGraph ??= new CodeGraph();
  return globalGraph;
}

export async function buildCodeGraphForFile(uri: vscode.Uri, graphPath = relativeGraphPath(uri)): Promise<void> {
  const graph = getCodeGraph();
  const normalizedPath = normalizeGraphPath(graphPath);
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    const imports = extractImports(content, document.languageId).map((specifier) => resolveImport(normalizedPath, specifier));
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", uri);
    const flatSymbols = flattenSymbols(Array.isArray(symbols) ? symbols : []);
    const nodes = flatSymbols.map((symbol) => ({
      uri: normalizedPath,
      symbolName: symbol.name,
      kind: vscode.SymbolKind[symbol.kind] || String(symbol.kind),
      imports,
      exports: isExported(content, symbol.name) ? [symbol.name] : [],
      references: [],
      callers: [],
      callees: []
    }));
    const edges: CodeGraphEdge[] = imports.map((specifier) => ({ from: normalizedPath, to: specifier, type: "import" }));
    for (const symbol of flatSymbols) {
      const from = symbolKey(normalizedPath, symbol.name);
      const position = symbol.selectionRange?.start || symbol.range.start;
      const callEdges = await collectCallEdges(uri, position, from);
      edges.push(...callEdges);
    }
    edges.push(...collectInheritanceEdges(content, normalizedPath));
    graph.replaceFile(normalizedPath, nodes, edges);
  } catch {
    graph.removeFile(normalizedPath);
  }
}

export function removeCodeGraphFile(uri: vscode.Uri): void {
  getCodeGraph().removeFile(relativeGraphPath(uri));
}

export function normalizeGraphPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^file:\/\//i, "").replace(/\/+$/, "");
}

function symbolKey(file: string, symbol: string): string {
  return `${normalizeGraphPath(file)}${SYMBOL_SEPARATOR}${symbol}`;
}

function normalizeEdgeEndpoint(endpoint: string): string {
  const separatorIndex = endpoint.indexOf(SYMBOL_SEPARATOR);
  if (separatorIndex >= 0) return symbolKey(endpoint.slice(0, separatorIndex), endpoint.slice(separatorIndex + SYMBOL_SEPARATOR.length));
  const legacySymbol = endpoint.match(/^(.*\.(?:[cm]?[jt]sx?|py|java|go|rs|rb|php|cs|c(?:pp)?|h)):(.+)$/i);
  return legacySymbol ? symbolKey(legacySymbol[1], legacySymbol[2]) : normalizeGraphPath(endpoint);
}

function fileFromEndpoint(endpoint: string): string {
  const separatorIndex = endpoint.indexOf(SYMBOL_SEPARATOR);
  return separatorIndex < 0 ? normalizeGraphPath(endpoint) : normalizeGraphPath(endpoint.slice(0, separatorIndex));
}

function sameFile(left: string, right: string): boolean {
  return stripKnownExtension(normalizeGraphPath(left)) === stripKnownExtension(normalizeGraphPath(right));
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(?:[cm]?[jt]sx?|py|java|go|rs|rb|php|cs|c(?:pp)?|h)$/i, "");
}

function relativeGraphPath(uri: vscode.Uri): string {
  for (const folder of getWorkspaceFolders()) {
    if (isSubpath(folder.uri.fsPath, uri.fsPath)) {
      const relative = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
      return getWorkspaceFolders().length > 1 ? `${folder.name}/${relative}` : relative;
    }
  }
  return uri.fsPath;
}

function resolveImport(source: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return normalizeGraphPath(path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)));
}

function extractImports(content: string, languageId: string): string[] {
  const imports: string[] = [];
  if (["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(languageId)) {
    const matcher = /(?:import\s+(?:.*?\s+from\s+)?|export\s+.*?\s+from\s+|require\s*\()\s*["']([^"']+)["']\)?/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(content))) imports.push(match[1]);
  } else if (languageId === "python") {
    const matcher = /(?:from\s+([^\s]+)\s+)?import\s+([^\s]+)/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(content))) imports.push(match[1] || match[2]);
  }
  return [...new Set(imports)];
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const flattened: vscode.DocumentSymbol[] = [];
  const visit = (symbol: vscode.DocumentSymbol) => {
    flattened.push(symbol);
    for (const child of symbol.children || []) visit(child);
  };
  for (const symbol of symbols) visit(symbol);
  return flattened;
}

function isExported(content: string, symbol: string): boolean {
  return new RegExp(`\\bexport\\s+(?:default\\s+)?(?:class|function|const|let|interface|type)\\s+${escapeRegExp(symbol)}\\b`).test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectCallEdges(uri: vscode.Uri, position: vscode.Position, from: string): Promise<CodeGraphEdge[]> {
  try {
    const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", uri, position);
    const item = Array.isArray(prepared) ? prepared[0] : undefined;
    if (!item) return [];
    const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>("vscode.provideOutgoingCalls", item) || [];
    return calls.map((call) => ({
      from,
      to: symbolKey(relativeGraphPath(call.to.uri), call.to.name),
      type: "call" as const
    }));
  } catch {
    return [];
  }
}

function collectInheritanceEdges(content: string, source: string): CodeGraphEdge[] {
  const edges: CodeGraphEdge[] = [];
  const matcher = /(?:class|interface)\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(content))) {
    edges.push({ from: symbolKey(source, match[1]), to: symbolKey(source, match[2]), type: "inheritance" });
  }
  return edges;
}
