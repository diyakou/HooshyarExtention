import { getWorkspaceCodeIndex } from "../codeIndex/workspaceCodeIndex";
import { getCodeGraph } from "../codeIndex/codeGraph";
import { SemanticSearchInput, SearchResult } from "../codeIndex/types";
import { logDebug } from "../logger";
import { getActiveProjectProfileManager } from "../projectProfile/profileManager";
import { createIsolatedAgentContext } from "./contextIsolation";

export interface SearchContext {
  query: string;
  projectContext?: {
    languages: string[];
    frameworks: string[];
  };
  recentFiles?: string[];
  maxResults?: number;
}

export class SearchAgent {
  private readonly cache = new Map<string, { expiresAt: number; results: SearchResult[] }>();

  async search(context: SearchContext): Promise<SearchResult[]> {
    const profile = await getActiveProjectProfileManager()?.getProfile();
    const isolated = createIsolatedAgentContext({
      goal: context.query,
      languages: profile?.languages.map((language) => language.name),
      frameworks: profile?.frameworks,
      relatedFiles: context.recentFiles,
      budget: context.maxResults
    });
    const cacheKey = JSON.stringify({ query: isolated.goal, scope: context.projectContext, recentFiles: context.recentFiles, maxResults: context.maxResults });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    logDebug(`SearchAgent: Searching for "${isolated.goal}"`);

    // Use semantic search from workspace index
    const searchInput: SemanticSearchInput = {
      query: isolated.goal,
      maxResults: isolated.budget
    };

    const codeIndex = getWorkspaceCodeIndex();
    const results = await codeIndex.search(searchInput);

    // Enhance results with code graph relationships
    const enhancedResults = await this.enhanceWithRelationships(results);

    // Rerank based on context
    const reranked = this.rerankResults(enhancedResults, context);

    this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, results: reranked });
    return reranked;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async enhanceWithRelationships(results: SearchResult[]): Promise<SearchResult[]> {
    const graph = getCodeGraph();

    return results.map(result => {
      const related = graph.getRelatedFiles(result.uri);
      return {
        ...result,
        // Add related files as additional context (not changing the SearchResult type, just enriching)
        snippet: related.length > 0
          ? `${result.snippet}\n\nRelated files: ${related.slice(0, 3).join(', ')}`
          : result.snippet
      };
    });
  }

  private rerankResults(results: SearchResult[], context: SearchContext): SearchResult[] {
    // Boost recent files
    if (context.recentFiles && context.recentFiles.length > 0) {
      return results.map(result => {
        const isRecent = context.recentFiles!.some(recent => result.uri.includes(recent));
        return {
          ...result,
          score: isRecent ? result.score * 1.2 : result.score
        };
      }).sort((a, b) => b.score - a.score);
    }

    return results;
  }

  async summarizeResults(results: SearchResult[]): Promise<string> {
    if (results.length === 0) {
      return "No results found.";
    }

    let summary = `Found ${results.length} relevant code locations:\n\n`;

    for (let i = 0; i < Math.min(5, results.length); i++) {
      const result = results[i];
      summary += `${i + 1}. **${result.uri}:${result.startLine}**\n`;
      if (result.symbol) {
        summary += `   Symbol: ${result.symbol}\n`;
      }
      summary += `   Score: ${result.score.toFixed(2)} (${result.source})\n`;
      summary += `   ${result.snippet.split('\n')[0].substring(0, 80)}...\n\n`;
    }

    if (results.length > 5) {
      summary += `... and ${results.length - 5} more results.\n`;
    }

    return summary;
  }
}

let globalSearchAgent: SearchAgent | undefined;

export function getSearchAgent(): SearchAgent {
  if (!globalSearchAgent) {
    globalSearchAgent = new SearchAgent();
  }
  return globalSearchAgent;
}
