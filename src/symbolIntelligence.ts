import * as vscode from "vscode";
import * as path from "path";
import { getWorkspaceFolders, isSubpath, resolveWorkspaceUri } from "./workspaceUtils";

export interface SymbolPositionInput {
  path?: string;
  line?: number;
  character?: number;
  symbol?: string;
}

export async function findSymbolTool(input: { query?: string; maxResults?: number }): Promise<string> {
  const query = String(input.query || "").trim();
  if (!query) throw new Error("find_symbol requires 'query'.");
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query) || [];
  return JSON.stringify({
    results: symbols.slice(0, input.maxResults ?? 30).map((symbol) => ({
      name: symbol.name,
      kind: kindName(symbol.kind),
      container: symbol.containerName || undefined,
      uri: relativePath(symbol.location.uri),
      line: symbol.location.range.start.line + 1,
      character: symbol.location.range.start.character + 1
    }))
  }, null, 2);
}

export async function findDefinitionTool(input: SymbolPositionInput): Promise<string> {
  const target = await resolvePosition(input);
  const locations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
    "vscode.executeDefinitionProvider", target.uri, target.position
  ) || [];
  return formatLocations("definitions", locations);
}

export async function findReferencesTool(input: SymbolPositionInput & { includeDeclaration?: boolean }): Promise<string> {
  const target = await resolvePosition(input);
  const locations = await vscode.commands.executeCommand<vscode.Location[]>(
    "vscode.executeReferenceProvider", target.uri, target.position, { includeDeclaration: input.includeDeclaration ?? true }
  ) || [];
  return formatLocations("references", locations);
}

export async function findImplementationsTool(input: SymbolPositionInput): Promise<string> {
  const target = await resolvePosition(input);
  const locations = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
    "vscode.executeImplementationProvider", target.uri, target.position
  ) || [];
  return formatLocations("implementations", locations);
}

export async function getHoverTool(input: SymbolPositionInput): Promise<string> {
  const target = await resolvePosition(input);
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", target.uri, target.position) || [];
  const contents = hovers.flatMap((hover) => hover.contents).map((content) => {
    if (typeof content === "string") return content;
    if ("value" in content) return content.value;
    return String(content);
  });
  return JSON.stringify({ uri: relativePath(target.uri), line: target.position.line + 1, contents }, null, 2);
}

export async function getDocumentSymbolsTool(input: { path?: string }): Promise<string> {
  if (!input.path) throw new Error("get_document_symbols requires 'path'.");
  const uri = resolveWorkspaceUri(input.path).uri;
  const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
    "vscode.executeDocumentSymbolProvider", uri
  ) || [];
  return JSON.stringify({ uri: input.path, symbols: symbols.map(serializeDocumentSymbol) }, null, 2);
}

export async function getCallHierarchyTool(input: SymbolPositionInput & { direction?: "incoming" | "outgoing" }): Promise<string> {
  const target = await resolvePosition(input);
  const roots = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
    "vscode.prepareCallHierarchy", target.uri, target.position
  ) || [];
  const direction = input.direction ?? "incoming";
  const command = direction === "incoming" ? "vscode.provideIncomingCalls" : "vscode.provideOutgoingCalls";
  const calls = roots[0] ? await vscode.commands.executeCommand<any[]>(command, roots[0]) || [] : [];
  return JSON.stringify({
    direction,
    root: roots[0] ? serializeHierarchyItem(roots[0]) : null,
    calls: calls.map((call) => serializeHierarchyItem(direction === "incoming" ? call.from : call.to))
  }, null, 2);
}

export async function renameSymbolTool(input: SymbolPositionInput & { newName?: string }): Promise<string> {
  if (!input.newName?.trim()) throw new Error("rename_symbol requires 'newName'.");
  const target = await resolvePosition(input);
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    "vscode.executeDocumentRenameProvider", target.uri, target.position, input.newName.trim()
  );
  if (!edit) throw new Error("The language service could not produce a rename edit.");
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) throw new Error("VS Code rejected the workspace rename edit.");
  return `Renamed symbol to ${input.newName.trim()} using the VS Code language service.`;
}

async function resolvePosition(input: SymbolPositionInput): Promise<{ uri: vscode.Uri; position: vscode.Position }> {
  if (input.path) {
    const uri = resolveWorkspaceUri(input.path).uri;
    return { uri, position: new vscode.Position(Math.max(0, (input.line ?? 1) - 1), Math.max(0, (input.character ?? 1) - 1)) };
  }
  if (input.symbol) {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", input.symbol) || [];
    const exact = symbols.find((symbol) => symbol.name === input.symbol) || symbols[0];
    if (exact) return { uri: exact.location.uri, position: exact.location.range.start };
  }
  throw new Error("Provide either path with line/character, or a resolvable symbol name.");
}

function formatLocations(label: string, locations: Array<vscode.Location | vscode.LocationLink>): string {
  return JSON.stringify({
    [label]: locations.map((location) => {
      const linked = location as vscode.LocationLink;
      const isLink = Boolean(linked.targetUri && linked.targetSelectionRange);
      const uri = isLink ? linked.targetUri : (location as vscode.Location).uri;
      const range = isLink ? linked.targetSelectionRange! : (location as vscode.Location).range;
      return { uri: relativePath(uri), line: range.start.line + 1, character: range.start.character + 1 };
    })
  }, null, 2);
}

function serializeDocumentSymbol(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): Record<string, unknown> {
  const range = "range" in symbol ? symbol.range : symbol.location.range;
  return {
    name: symbol.name,
    kind: kindName(symbol.kind),
    startLine: range.start.line + 1,
    endLine: range.end.line + 1,
    children: "children" in symbol ? symbol.children.map(serializeDocumentSymbol) : undefined
  };
}

function serializeHierarchyItem(item: vscode.CallHierarchyItem | undefined): Record<string, unknown> | null {
  if (!item) return null;
  return { name: item.name, kind: kindName(item.kind), uri: relativePath(item.uri), line: item.range.start.line + 1 };
}

function kindName(kind: vscode.SymbolKind): string {
  return vscode.SymbolKind[kind] || String(kind);
}

function relativePath(uri: vscode.Uri): string {
  for (const folder of getWorkspaceFolders()) {
    if (isSubpath(folder.uri.fsPath, uri.fsPath)) return path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
  }
  return uri.fsPath;
}
