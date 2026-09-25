export interface IndexedChunk {
  id: string;
  uri: string;
  languageId: string;
  symbolName?: string;
  symbolKind?: string;
  startLine: number;
  endLine: number;
  content: string;
  imports: string[];
  exports: string[];
  hash: string;
  embedding?: number[];
  updatedAt: number;
}

export interface SearchResult {
  uri: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  score: number;
  source: "semantic" | "text" | "symbol";
  snippet: string;
}

export interface SemanticSearchInput {
  query: string;
  maxResults?: number;
  paths?: string[];
  language?: string;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly available: boolean;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
