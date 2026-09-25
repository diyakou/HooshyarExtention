import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import { contentHash, chunkDocument, SymbolRange } from "./chunker";
import { DisabledEmbeddingProvider } from "./embeddingProvider";
import { hybridSearch, SearchWeights } from "./hybridSearch";
import { rerankSearchResults } from "./reranker";
import { getCodeGraph, buildCodeGraphForFile, removeCodeGraphFile } from "./codeGraph";
import { EmbeddingProvider, IndexedChunk, SearchResult, SemanticSearchInput } from "./types";
import { DEFAULT_EXCLUDE_GLOB, getWorkspaceFolders, isSubpath } from "../workspaceUtils";
import { logDebug, logWarn } from "../logger";

interface PersistedIndex {
  version: 1;
  files: Record<string, { hash: string; chunks: IndexedChunk[] }>;
}

const INDEX_VERSION = 1;
const INDEX_FILE = "code-index-v1.json";

export class WorkspaceCodeIndex implements vscode.Disposable {
  private readonly files = new Map<string, { hash: string; chunks: IndexedChunk[] }>();
  private embeddingProvider: EmbeddingProvider = new DisabledEmbeddingProvider();
  private watcher?: vscode.FileSystemWatcher;
  private storagePath?: string;
  private persistTimer?: NodeJS.Timeout;
  private initialized = false;
  private indexing?: Promise<void>;

  async initialize(storageUri?: vscode.Uri): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.storagePath = storageUri?.fsPath;
    await this.load();
    if (typeof vscode.workspace.createFileSystemWatcher === "function") {
      this.watcher = vscode.workspace.createFileSystemWatcher("**/*");
      this.watcher.onDidCreate((uri) => void this.indexUri(uri));
      this.watcher.onDidChange((uri) => void this.indexUri(uri));
      this.watcher.onDidDelete((uri) => this.removeUri(uri));
    }
    void this.refresh();
  }

  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  async refresh(force = false): Promise<void> {
    if (this.indexing) return this.indexing;
    this.indexing = this.refreshInternal(force).finally(() => {
      this.indexing = undefined;
    });
    return this.indexing;
  }

  private async refreshInternal(force: boolean): Promise<void> {
    const cap = vscode.workspace.getConfiguration("hooshyar").get<number>("workspaceIndexMaxFiles", 2000);
    const uris = await vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE_GLOB, cap);
    for (const uri of uris) await this.indexUri(uri, force);
    const live = new Set(uris.map((uri) => uri.toString()));
    for (const uri of this.files.keys()) if (!live.has(uri)) this.files.delete(uri);
    this.schedulePersist();
  }

  async indexUri(uri: vscode.Uri, force = false): Promise<boolean> {
    if (uri.scheme !== "file") return false;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const maxBytes = vscode.workspace.getConfiguration("hooshyar").get<number>("maxFileBytes", 1_000_000);
      if (stat.size > maxBytes) return false;
      const document = await vscode.workspace.openTextDocument(uri);
      const content = document.getText();
      if (content.includes("\u0000")) return false;
      const hash = contentHash(content);
      const key = uri.toString();
      if (!force && this.files.get(key)?.hash === hash) return false;
      const symbols = await documentSymbols(uri);
      const previousEmbeddings = new Map(
        (this.files.get(key)?.chunks ?? []).filter((chunk) => chunk.embedding).map((chunk) => [chunk.hash, chunk.embedding!])
      );
      const chunks = chunkDocument(this.relativeUri(uri), document.languageId, content, symbols, stat.mtime);
      for (const chunk of chunks) chunk.embedding = previousEmbeddings.get(chunk.hash);
      if (this.embeddingProvider.available) {
        const missing = chunks.filter((chunk) => !chunk.embedding);
        if (missing.length > 0) {
          const embeddings = await this.embeddingProvider.embed(missing.map((chunk) => `${chunk.symbolName || ""}\n${chunk.content}`));
          missing.forEach((chunk, index) => { chunk.embedding = embeddings[index]; });
        }
      }
      this.files.set(key, { hash, chunks });
      await buildCodeGraphForFile(uri, this.relativeUri(uri));
      this.schedulePersist();
      return true;
    } catch (error: any) {
      logDebug(`Index skipped ${uri.fsPath}: ${error?.message ?? error}`);
      return false;
    }
  }

  removeUri(uri: vscode.Uri): void {
    if (this.files.delete(uri.toString())) this.schedulePersist();
    removeCodeGraphFile(uri);
  }

  allChunks(): IndexedChunk[] {
    return [...this.files.values()].flatMap((entry) => entry.chunks);
  }

  async search(input: SemanticSearchInput, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.initialized) await this.initialize();
    if (this.files.size === 0) await this.refresh();
    const cfg = vscode.workspace.getConfiguration("hooshyar.search");
    const weights: SearchWeights = {
      semantic: cfg.get<number>("semanticWeight", 0.5),
      text: cfg.get<number>("textWeight", 0.2),
      symbol: cfg.get<number>("symbolWeight", 0.2),
      context: cfg.get<number>("contextWeight", 0.1)
    };
    let queryEmbedding: number[] | undefined;
    if (this.embeddingProvider.available && !signal?.aborted) {
      queryEmbedding = (await this.embeddingProvider.embed([input.query], signal))[0];
    }
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const activePath = activeUri ? this.relativeUri(activeUri) : undefined;
    const recentUris = [...this.files.values()]
      .flatMap((entry) => entry.chunks)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((chunk) => chunk.uri)
      .filter((uri, index, uris) => uris.indexOf(uri) === index)
      .slice(0, 20);
    return rerankSearchResults(
      hybridSearch(this.allChunks(), input, weights, activePath, queryEmbedding),
      { activeUri: activePath, recentUris, graph: getCodeGraph() }
    );
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }

  private relativeUri(uri: vscode.Uri): string {
    const folders = getWorkspaceFolders();
    const folder = folders.find((item) => isSubpath(item.uri.fsPath, uri.fsPath));
    if (!folder) return uri.fsPath;
    const relative = path.relative(folder.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
    return folders.length > 1 ? `${folder.name}/${relative}` : relative;
  }

  private schedulePersist(): void {
    if (!this.storagePath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(), 500);
  }

  private async persist(): Promise<void> {
    if (!this.storagePath) return;
    const payload: PersistedIndex = { version: INDEX_VERSION, files: Object.fromEntries(this.files) };
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.writeFile(path.join(this.storagePath, INDEX_FILE), JSON.stringify(payload), "utf8");
  }

  private async load(): Promise<void> {
    if (!this.storagePath) return;
    try {
      const raw = await fs.readFile(path.join(this.storagePath, INDEX_FILE), "utf8");
      const parsed = JSON.parse(raw) as PersistedIndex;
      if (parsed.version !== INDEX_VERSION || !parsed.files) return;
      for (const [uri, entry] of Object.entries(parsed.files)) this.files.set(uri, entry);
    } catch (error: any) {
      if (error?.code !== "ENOENT") logWarn(`Code index cache ignored: ${error?.message ?? error}`);
    }
  }
}

async function documentSymbols(uri: vscode.Uri): Promise<SymbolRange[]> {
  const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
    "vscode.executeDocumentSymbolProvider",
    uri
  );
  if (!Array.isArray(symbols)) return [];
  const result: SymbolRange[] = [];
  const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation) => {
    const range = "range" in symbol ? symbol.range : symbol.location.range;
    result.push({
      name: symbol.name,
      kind: vscode.SymbolKind[symbol.kind] || String(symbol.kind),
      startLine: range.start.line,
      endLine: range.end.line
    });
    if ("children" in symbol) symbol.children.forEach(visit);
  };
  symbols.forEach(visit);
  return result;
}

let singleton: WorkspaceCodeIndex | undefined;

export function getWorkspaceCodeIndex(): WorkspaceCodeIndex {
  singleton ??= new WorkspaceCodeIndex();
  return singleton;
}
