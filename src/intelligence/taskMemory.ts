import { logDebug } from '../logger';

export interface TaskDecision {
    description: string;
    timestamp: number;
    rationale?: string;
}

export interface SymbolEdit {
    symbolName: string;
    file: string;
    editType: 'created' | 'modified' | 'deleted';
    timestamp: number;
}

export interface RelevantSymbolLocation {
    file: string;
    startLine: number;
    endLine: number;
}

export interface CachedSearchResult {
    result: string;
    timestamp: number;
}

export interface TaskMemory {
    goal: string;
    confirmedArchitecture: string[];
    relevantSymbols: Map<string, RelevantSymbolLocation>;
    inspectedFiles: Set<string>;
    modifiedFiles: Map<string, SymbolEdit[]>;
    openIssues: string[];
    validationFailures: string[];
    decisions: TaskDecision[];
    discoveredDependencies: Map<string, string[]>;
    cachedSearchResults: Map<string, CachedSearchResult>;
}

export class TaskMemoryManager {
    private activeTask: TaskMemory | undefined;

    /**
     * Creates a new task and returns a taskId (a unique string).
     */
    public createTask(goal: string): string {
        this.activeTask = {
            goal,
            confirmedArchitecture: [],
            relevantSymbols: new Map(),
            inspectedFiles: new Set(),
            modifiedFiles: new Map(),
            openIssues: [],
            validationFailures: [],
            decisions: [],
            discoveredDependencies: new Map(),
            cachedSearchResults: new Map(),
        };
        const taskId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        logDebug(`Task created with ID: ${taskId}`);
        return taskId;
    }

    public getActiveTask(): TaskMemory | undefined {
        return this.activeTask;
    }

    public updateGoal(goal: string): void {
        if (this.activeTask) {
            this.activeTask.goal = goal;
            logDebug('Task goal updated');
        }
    }

    public addRelevantSymbol(name: string, location: RelevantSymbolLocation): void {
        if (this.activeTask) {
            this.activeTask.relevantSymbols.set(name, location);
        }
    }

    public markFileInspected(file: string): void {
        if (this.activeTask) {
            this.activeTask.inspectedFiles.add(file);
        }
    }

    public isFileInspected(file: string): boolean {
        return this.activeTask ? this.activeTask.inspectedFiles.has(file) : false;
    }

    public trackFileModification(file: string, symbolName: string, editType: SymbolEdit['editType']): void {
        if (this.activeTask) {
            let edits = this.activeTask.modifiedFiles.get(file);
            if (!edits) {
                edits = [];
                this.activeTask.modifiedFiles.set(file, edits);
            }
            edits.push({
                symbolName,
                file,
                editType,
                timestamp: Date.now(),
            });
        }
    }

    public addIssue(issue: string): void {
        if (this.activeTask) {
            this.activeTask.openIssues.push(issue);
        }
    }

    public resolveIssue(issue: string): void {
        if (this.activeTask) {
            this.activeTask.openIssues = this.activeTask.openIssues.filter(i => i !== issue);
        }
    }

    public addValidationFailure(failure: string): void {
        if (this.activeTask) {
            this.activeTask.validationFailures.push(failure);
        }
    }

    public clearValidationFailures(): void {
        if (this.activeTask) {
            this.activeTask.validationFailures = [];
        }
    }

    public addDecision(description: string, rationale?: string): void {
        if (this.activeTask) {
            this.activeTask.decisions.push({
                description,
                timestamp: Date.now(),
                rationale,
            });
        }
    }

    public cacheSearchResult(query: string, result: string): void {
        if (this.activeTask) {
            this.activeTask.cachedSearchResults.set(query, {
                result,
                timestamp: Date.now(),
            });
        }
    }

    public getCachedSearchResult(query: string): string | undefined {
        if (!this.activeTask) return undefined;
        const cached = this.activeTask.cachedSearchResults.get(query);
        if (cached) {
            const ageMs = Date.now() - cached.timestamp;
            if (ageMs < 60000) {
                return cached.result;
            } else {
                this.activeTask.cachedSearchResults.delete(query);
            }
        }
        return undefined;
    }

    public addDependency(symbol: string, dependency: string): void {
        if (this.activeTask) {
            let deps = this.activeTask.discoveredDependencies.get(symbol);
            if (!deps) {
                deps = [];
                this.activeTask.discoveredDependencies.set(symbol, deps);
            }
            if (!deps.includes(dependency)) {
                deps.push(dependency);
            }
        }
    }

    public toCompactSummary(): string {
        if (!this.activeTask) {
            return 'No active task memory.';
        }

        const task = this.activeTask;
        const lines: string[] = [];

        lines.push('## Task Working Memory');
        lines.push(`### Goal: ${task.goal}`);
        
        if (task.confirmedArchitecture.length > 0) {
            lines.push(`### Architecture: ${task.confirmedArchitecture.join(', ')}`);
        } else {
            lines.push('### Architecture: None');
        }

        lines.push('### Relevant Symbols:');
        if (task.relevantSymbols.size > 0) {
            for (const [symbol, loc] of task.relevantSymbols.entries()) {
                lines.push(`- ${symbol} (${loc.file}:${loc.startLine}-${loc.endLine})`);
            }
        } else {
            lines.push('None');
        }

        const modifiedFilesList = Array.from(task.modifiedFiles.keys());
        if (modifiedFilesList.length > 0) {
            lines.push(`### Modified Files: ${modifiedFilesList.join(', ')}`);
        } else {
            lines.push('### Modified Files: None');
        }

        if (task.openIssues.length > 0) {
            lines.push(`### Open Issues: ${task.openIssues.join('; ')}`);
        } else {
            lines.push('### Open Issues: None');
        }

        if (task.decisions.length > 0) {
            const decisionsSummary = task.decisions.map(d => d.description).join('; ');
            lines.push(`### Decisions: ${decisionsSummary}`);
        } else {
            lines.push('### Decisions: None');
        }

        return lines.join('\n');
    }

    public reset(): void {
        this.activeTask = undefined;
    }
}

let instance: TaskMemoryManager | undefined;

export function getTaskMemoryManager(): TaskMemoryManager {
    if (!instance) {
        instance = new TaskMemoryManager();
    }
    return instance;
}
