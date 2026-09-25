import { SearchResult } from "./types";
import { CodeGraph } from "./codeGraph";

export interface RerankContext {
  activeUri?: string;
  recentUris?: readonly string[];
  graph?: CodeGraph;
}

export function rerankSearchResults(results: SearchResult[], context: RerankContext): SearchResult[] {
  const activeRelated = context.activeUri && context.graph
    ? new Set(context.graph.getRelatedFiles(context.activeUri))
    : new Set<string>();
  const recent = new Set(context.recentUris || []);
  return results
    .map((result) => {
      let score = result.score;
      if (result.uri === context.activeUri) score += 0.2;
      if (recent.has(result.uri)) score += 0.1;
      if (activeRelated.has(result.uri)) score += 0.08;
      return { ...result, score: Number(score.toFixed(6)) };
    })
    .sort((left, right) => right.score - left.score || left.uri.localeCompare(right.uri) || left.startLine - right.startLine);
}
