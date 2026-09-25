import { IndexedChunk, SearchResult, SemanticSearchInput } from "./types";

export interface SearchWeights {
  semantic: number;
  text: number;
  symbol: number;
  context: number;
}

const QUERY_EXPANSIONS: Record<string, string[]> = {
  auth: ["authentication", "authorize", "login", "token"],
  authentication: ["auth", "authorize", "login", "token"],
  config: ["configuration", "settings", "options"],
  configuration: ["config", "settings", "options"],
  error: ["exception", "failure", "throw"],
  test: ["spec", "testing", "assert"],
  database: ["db", "repository", "query"],
  api: ["endpoint", "request", "response"]
};

export function hybridSearch(
  chunks: IndexedChunk[],
  input: SemanticSearchInput,
  weights: SearchWeights,
  activeUri?: string,
  queryEmbedding?: number[]
): SearchResult[] {
  const queryTokens = expandQuery(tokenize(input.query));
  const documents = chunks.map((chunk) => tokenize(`${chunk.symbolName || ""}\n${chunk.content}`));
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of new Set(document)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const averageDocumentLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(documents.length, 1);
  const now = Date.now();

  return chunks
    .filter((chunk) => !input.language || chunk.languageId.toLowerCase() === input.language.toLowerCase())
    .filter((chunk) => !input.paths?.length || input.paths.some((prefix) => chunk.uri.includes(prefix)))
    .map((chunk, index) => {
      const contentTokens = tokenize(chunk.content);
      const symbolTokens = tokenize(chunk.symbolName || "");
      const textScore = bm25Score(queryTokens, contentTokens, documentFrequency, documents.length, averageDocumentLength);
      const symbolScore = bm25Score(queryTokens, symbolTokens, documentFrequency, documents.length, averageDocumentLength);
      const lexicalScore = Math.max(textScore, symbolScore);
      const semanticScore = queryEmbedding && chunk.embedding ? cosine(queryEmbedding, chunk.embedding) : lexicalScore;
      const recency = Math.max(0, 1 - (now - chunk.updatedAt) / (1000 * 60 * 60 * 24 * 30));
      const active = activeUri && chunk.uri === activeUri ? 1 : 0;
      const contextScore = Math.max(recency, active);
      const score = semanticScore * weights.semantic + textScore * weights.text + symbolScore * weights.symbol * 1.5 + contextScore * weights.context;
      const source: SearchResult["source"] = queryEmbedding
        ? "semantic"
        : symbolScore > 0 && Boolean(chunk.symbolName) && queryTokens.some((token) => symbolTokens.includes(token))
        ? "symbol"
        : "text";
      return {
        uri: chunk.uri,
        startLine: chunk.startLine + 1,
        endLine: chunk.endLine + 1,
        symbol: chunk.symbolName,
        score: Number(score.toFixed(6)),
        source,
        snippet: chunk.content.slice(0, 1200),
        _index: index
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.uri.localeCompare(b.uri) || a.startLine - b.startLine || a._index - b._index)
    .slice(0, Math.min(50, Math.max(1, input.maxResults ?? 10)))
    .map(({ _index, ...result }) => result);
}

export function tokenize(text: string): string[] {
  return (text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}_]{2,}/gu) || []);
}

export function expandQuery(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const related of QUERY_EXPANSIONS[token] || []) expanded.add(related);
  }
  return [...expanded];
}

function bm25Score(
  queryTokens: string[],
  documentTokens: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
  averageDocumentLength: number
): number {
  if (queryTokens.length === 0 || documentTokens.length === 0) return 0;
  const termFrequency = new Map<string, number>();
  for (const token of documentTokens) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of queryTokens) {
    const frequency = termFrequency.get(token) || 0;
    if (frequency === 0) continue;
    const frequencyInCorpus = documentFrequency.get(token) || 0;
    const idf = Math.log(1 + (documentCount - frequencyInCorpus + 0.5) / (frequencyInCorpus + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (documentTokens.length / Math.max(averageDocumentLength, 1)));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }
  return score / queryTokens.length;
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? Math.max(0, dot / Math.sqrt(aa * bb)) : 0;
}
