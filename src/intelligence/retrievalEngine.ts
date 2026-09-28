import * as vscode from 'vscode';
import { CodebaseIntelligence, SymbolInfo, SymbolRef } from './codebaseIntelligence';
import { ContextRanker, RankedContextItem } from './contextRanker';
import { IncrementalIndexer } from './incrementalIndexer';
import { logDebug, logInfo } from '../logger';
import { resolveWorkspaceUri } from '../workspaceUtils';

export interface RetrievalRequest {
    query: string;
    primarySymbols?: string[];
    taskGoal?: string;
    currentFile?: string;
    modifiedFiles?: string[];
    maxTokenBudget?: number;
    expansionDepth?: number;
}

export interface RetrievalResult {
    items: RankedContextItem[];
    primarySymbols: SymbolInfo[];
    dependencies: SymbolRef[];
    callers: SymbolRef[];
    relatedTests: string[];
    totalTokens: number;
    retrievalTimeMs: number;
}

export class RetrievalEngine {
    constructor(
        private intelligence: CodebaseIntelligence,
        private ranker: ContextRanker,
        private indexer: IncrementalIndexer
    ) {}

    public async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
        const startTime = Date.now();
        const maxTokens = request.maxTokenBudget ?? 20000;
        const expansionDepth = request.expansionDepth ?? 2;

        logInfo(`Starting retrieval for query: "${request.query}"`);

        // a. Symbol Discovery
        let primarySymbolNames = request.primarySymbols || [];
        if (primarySymbolNames.length === 0) {
            primarySymbolNames = this.extractKeywords(request.query);
        }

        const primarySymbols: SymbolInfo[] = [];
        for (const name of primarySymbolNames) {
            const resolvedList = await this.intelligence.findSymbol(name);
            if (resolvedList && resolvedList.length > 0) {
                primarySymbols.push(resolvedList[0]);
            }
        }

        const dependencies: SymbolRef[] = [];
        const callers: SymbolRef[] = [];
        const relatedTests: Set<string> = new Set();
        const unrankedItems: any[] = [];

        // b. Primary Context
        for (const sym of primarySymbols) {
            const content = await this.intelligence.getSymbolCode(sym.file, sym.startLine, sym.endLine);
            unrankedItems.push({
                uri: resolveWorkspaceUri(sym.file).uri.toString(),
                content,
                type: 'symbol',
                metadata: { symbol: sym.name, file: resolveWorkspaceUri(sym.file).uri.fsPath }
            });
            
            // e. Test Discovery
            const testFiles = await this.intelligence.findRelatedTests(sym.file);
            testFiles.forEach(tf => relatedTests.add(tf));
            
            // c. Dependency Expansion (Level 1)
            if (expansionDepth >= 1) {
                const deps = sym.dependencies;
                for (const dep of deps) {
                    dependencies.push(dep);
                    unrankedItems.push({
                        uri: resolveWorkspaceUri(dep.file).uri.toString(),
                        content: `Dependency of ${sym.name}: ${dep.name}`, // Placeholder for actual retrieval
                        type: 'dependency',
                        metadata: { symbol: dep.name, file: resolveWorkspaceUri(dep.file).uri.fsPath }
                    });
                }
            }
            
            // d. Caller Analysis (Level 1)
            if (expansionDepth >= 1) {
                const callRefs = sym.callers;
                for (const caller of callRefs) {
                    callers.push(caller);
                     unrankedItems.push({
                        uri: resolveWorkspaceUri(caller.file).uri.toString(),
                        content: `Caller of ${sym.name}: ${caller.name}`,
                        type: 'caller',
                        metadata: { symbol: caller.name, file: resolveWorkspaceUri(caller.file).uri.fsPath }
                    });
                }
            }
            
            // c. Dependency Expansion (Level 2)
            if (expansionDepth >= 2) {
                 const deps = sym.dependencies;
                 for (const dep of deps) {
                     const resolvedDepList = await this.intelligence.findSymbol(dep.name);
                     if (resolvedDepList && resolvedDepList.length > 0) {
                         const resolvedDep = resolvedDepList[0];
                         const depDeps = resolvedDep.dependencies;
                         for (const dDep of depDeps) {
                             unrankedItems.push({
                                uri: resolveWorkspaceUri(dDep.file).uri.toString(),
                                content: `Dependency of ${dep.name}: ${dDep.name}`, 
                                type: 'dependency_l2',
                                metadata: { symbol: dDep.name, file: resolveWorkspaceUri(dDep.file).uri.fsPath }
                            });
                         }
                     }
                 }
            }
        }

        // f. Config Discovery
        const lowerQuery = request.query.toLowerCase();
        if (lowerQuery.includes('config') || lowerQuery.includes('settings') || lowerQuery.includes('env')) {
            const configFiles = await vscode.workspace.findFiles('**/{*.json,*.yml,*.yaml,*.env}');
            for (const file of configFiles) {
                unrankedItems.push({
                    uri: file.toString(),
                    content: 'Config file reference', // Placeholder
                    type: 'config',
                    metadata: { file: file.fsPath }
                });
            }
        }

        // Add related tests to unranked items
        for (const testUri of relatedTests) {
            unrankedItems.push({
                uri: testUri,
                content: 'Test file reference',
                type: 'test',
                metadata: { file: testUri }
            });
        }
        
        // i. Deduplication
        const uniqueItemsMap = new Map<string, any>();
        for (const item of unrankedItems) {
            const key = `${item.uri}-${item.metadata?.symbol || ''}`;
            if (!uniqueItemsMap.has(key)) {
                uniqueItemsMap.set(key, item);
            }
        }
        const deduplicatedUnranked = Array.from(uniqueItemsMap.values());

        // g. Ranking
        let rankedItems: RankedContextItem[] = [];
        try {
             if ('rank' in this.ranker) {
                 // Assuming Ranker has rank method
                 rankedItems = await (this.ranker as any).rank(deduplicatedUnranked, request.query);
             } else {
                 rankedItems = deduplicatedUnranked.map((item, idx) => ({
                     id: `item-${idx}`,
                     file: item.metadata?.file || '',
                     content: item.content,
                     signals: [],
                     score: 1 - (idx * 0.01),
                     estimatedTokens: Math.ceil((item.content?.length || 100) / 4),
                     source: item.type
                 })) as RankedContextItem[];
             }
        } catch (err) {
            logDebug(`Error during ranking: ${err}`);
            rankedItems = deduplicatedUnranked.map((item, idx) => ({
                     id: `item-${idx}`,
                     file: item.metadata?.file || '',
                     content: item.content,
                     signals: [],
                     score: 1 - (idx * 0.01),
                     estimatedTokens: Math.ceil((item.content?.length || 100) / 4),
                     source: item.type
                 })) as RankedContextItem[];
        }

        // h. Budget Enforcement
        const selectedItems: RankedContextItem[] = [];
        let totalTokens = 0;
        
        // Very rough approximation: 1 token = 4 characters
        for (const item of rankedItems) {
            const itemTokens = Math.ceil((item.content?.length || 100) / 4);
            if (totalTokens + itemTokens <= maxTokens) {
                selectedItems.push(item);
                totalTokens += itemTokens;
            } else {
                break;
            }
        }

        const retrievalTimeMs = Date.now() - startTime;
        logInfo(`Retrieval finished in ${retrievalTimeMs}ms. Selected ${selectedItems.length} items (${totalTokens} tokens).`);

        return {
            items: selectedItems,
            primarySymbols,
            dependencies,
            callers,
            relatedTests: Array.from(relatedTests),
            totalTokens,
            retrievalTimeMs
        };
    }

    public extractKeywords(query: string): string[] {
        const keywords = new Set<string>();
        
        // Extract quoted strings
        const quotedMatches = query.match(/["']([^"']+)["']/g);
        if (quotedMatches) {
            quotedMatches.forEach(m => keywords.add(m.replace(/["']/g, '')));
        }
        
        const words = query.split(/[^a-zA-Z0-9_]+/);
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'in', 'on', 'at', 'to', 'from', 'of', 'for', 'with', 'by', 'about', 'like', 'through', 'over', 'before', 'between', 'after', 'since', 'without', 'under', 'within', 'along', 'following', 'across', 'behind', 'beyond', 'plus', 'except', 'but', 'up', 'out', 'around', 'down', 'off', 'above', 'near', 'create', 'update', 'delete', 'make', 'add', 'remove', 'get', 'set', 'find', 'search']);
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word.length < 3) continue;
            
            // CamelCase/PascalCase detection
            if (/^[A-Z][a-zA-Z0-9]*$/.test(word) || /^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(word)) {
                if (!stopWords.has(word.toLowerCase())) {
                    keywords.add(word);
                }
            }
            
            // Words after certain prepositions
            if (i > 0) {
                const prevWord = words[i - 1].toLowerCase();
                if (['in', 'from', 'to', 'of'].includes(prevWord)) {
                    if (!stopWords.has(word.toLowerCase())) {
                        keywords.add(word);
                    }
                }
            }
        }
        
        return Array.from(keywords);
    }

    }
