import { estimateTokens } from "../contextManager";

export interface ContextRequest {
  query: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ContextItem {
  id: string;
  content: string;
  source: string;
  relevance: number;
  priority: number;
  estimatedTokens?: number;
  essential?: boolean;
}

export interface ContextProvider {
  id: string;
  collect(request: ContextRequest): Promise<ContextItem[]>;
}

export interface ContextSelection {
  items: ContextItem[];
  usedTokens: number;
  omitted: number;
}

export class ContextEngine {
  private readonly providers = new Map<string, ContextProvider>();

  register(provider: ContextProvider, replace = false): void {
    if (!replace && this.providers.has(provider.id)) {
      throw new Error(`Context provider '${provider.id}' is already registered.`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  async collect(request: ContextRequest): Promise<ContextSelection> {
    const groups = await Promise.all(
      [...this.providers.values()].map((provider) =>
        request.signal?.aborted ? Promise.resolve([]) : provider.collect(request)
      )
    );
    return this.select(groups.flat(), request.maxTokens);
  }

  select(items: ContextItem[], maxTokens: number): ContextSelection {
    const ranked = [...items]
      .filter((item) => item.content.trim().length > 0)
      .map((item) => ({ ...item, estimatedTokens: item.estimatedTokens ?? estimateTokens(item.content) }))
      .sort((a, b) => {
        if (Boolean(a.essential) !== Boolean(b.essential)) return a.essential ? -1 : 1;
        return b.priority * b.relevance - a.priority * a.relevance;
      });
    const selected: ContextItem[] = [];
    let usedTokens = 0;
    for (const item of ranked) {
      const tokens = item.estimatedTokens ?? 0;
      if (!item.essential && usedTokens + tokens > maxTokens) continue;
      selected.push(item);
      usedTokens += tokens;
    }
    return { items: selected, usedTokens, omitted: ranked.length - selected.length };
  }
}
