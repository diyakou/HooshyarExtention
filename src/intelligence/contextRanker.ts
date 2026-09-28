import { logDebug } from '../logger';

export type RelevanceSignal =
    | 'exactSymbolMatch'
    | 'filenameMatch'
    | 'semanticMatch'
    | 'directCaller'
    | 'directReference'
    | 'importRelationship'
    | 'testRelationship'
    | 'diagnosticRelated'
    | 'currentEditor'
    | 'recentlyModified'
    | 'gitChanged'
    | 'taskDependency'
    | 'modelRequested'
    | 'keywordMatch';

export interface RankedContextItem {
    id: string;
    content: string;
    file: string;
    symbolName?: string;
    startLine?: number;
    endLine?: number;
    signals: RelevanceSignal[];
    score: number;
    estimatedTokens: number;
    source: string;
}

export interface RankingConfig {
    exactSymbolMatch: number;
    filenameMatch: number;
    semanticMatch: number;
    directCaller: number;
    directReference: number;
    importRelationship: number;
    testRelationship: number;
    diagnosticRelated: number;
    currentEditor: number;
    recentlyModified: number;
    gitChanged: number;
    taskDependency: number;
    modelRequested: number;
    keywordMatch: number;
}

export const defaultRankingConfig: RankingConfig = {
    exactSymbolMatch: 1.0,
    directCaller: 0.9,
    directReference: 0.85,
    importRelationship: 0.8,
    testRelationship: 0.7,
    filenameMatch: 0.65,
    diagnosticRelated: 0.75,
    currentEditor: 0.6,
    recentlyModified: 0.55,
    gitChanged: 0.5,
    taskDependency: 0.8,
    modelRequested: 0.95,
    semanticMatch: 0.4,
    keywordMatch: 0.3
};

export class ContextRanker {
    private config: RankingConfig;

    constructor(config?: Partial<RankingConfig>) {
        this.config = { ...defaultRankingConfig, ...config };
    }

    public rank(items: RankedContextItem[]): RankedContextItem[] {
        logDebug(`Ranking ${items.length} context items`);
        
        // Ensure scores are up-to-date and sort by score descending
        const scoredItems = items.map(item => {
            item.score = this.scoreItem(item);
            item.estimatedTokens = item.estimatedTokens || Math.ceil(item.content.length / 4);
            return item;
        });

        return scoredItems.sort((a, b) => b.score - a.score);
    }

    public addSignal(item: RankedContextItem, signal: RelevanceSignal): void {
        if (!item.signals.includes(signal)) {
            item.signals.push(signal);
            item.score = this.scoreItem(item);
        }
    }

    public selectTopN(items: RankedContextItem[], tokenBudget: number): RankedContextItem[] {
        logDebug(`Selecting top context items within budget of ${tokenBudget} tokens`);
        const rankedItems = this.rank(items);
        const selected: RankedContextItem[] = [];
        let currentTokens = 0;

        for (const item of rankedItems) {
            const itemTokens = item.estimatedTokens || Math.ceil(item.content.length / 4);
            if (currentTokens + itemTokens <= tokenBudget) {
                selected.push(item);
                currentTokens += itemTokens;
            }
        }

        logDebug(`Selected ${selected.length} items using ${currentTokens} tokens`);
        return selected;
    }

    public deduplicateByFile(items: RankedContextItem[]): RankedContextItem[] {
        const deduplicatedMap = new Map<string, RankedContextItem>();

        for (const item of items) {
            item.score = item.score || this.scoreItem(item);
            const dedupeKey = item.symbolName 
                ? `${item.file}::${item.symbolName}` 
                : item.file;
            
            const existing = deduplicatedMap.get(dedupeKey);
            if (!existing || item.score > existing.score) {
                deduplicatedMap.set(dedupeKey, item);
            }
        }

        return Array.from(deduplicatedMap.values());
    }

    public scoreItem(item: RankedContextItem): number {
        if (!item.signals || item.signals.length === 0) {
            return 0;
        }

        const weights = item.signals.map(signal => this.config[signal] ?? 0);
        
        const maxWeight = Math.max(...weights);
        const sumWeights = weights.reduce((sum, w) => sum + w, 0);
        const meanWeight = sumWeights / weights.length;

        // composite score = max(individual signal weights) * 0.7 + mean(individual signal weights) * 0.3
        const score = (maxWeight * 0.7) + (meanWeight * 0.3);
        
        return Math.min(score, 1.0);
    }
}
