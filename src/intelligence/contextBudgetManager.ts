import { Message } from '../types';
import { logDebug, logInfo } from '../logger';

export type ContextSlot = 
  | 'system'
  | 'tools'
  | 'userRequest'
  | 'conversationHistory'
  | 'projectRules'
  | 'taskState'
  | 'codeContext'
  | 'toolResults'
  | 'responseReserve'
  | 'repairReserve';

export interface BudgetAllocation {
  slot: ContextSlot;
  allocatedChars: number;
  usedChars: number;
  priority: number;
  essential: boolean;
}

export interface BudgetConfig {
  totalBudgetChars: number;
  softLimitPercent: number;
  hardLimitPercent: number;
  defaultAllocations: Record<ContextSlot, { percent: number; priority: number; essential: boolean }>;
}

export interface CompactionResult {
  removedChars: number;
  removedItems: number;
  compactedSlots: ContextSlot[];
}

const DEFAULT_CONFIG: BudgetConfig = {
  totalBudgetChars: 200000, // Roughly 50k tokens * 4 chars/token
  softLimitPercent: 0.75,
  hardLimitPercent: 0.9,
  defaultAllocations: {
    system: { percent: 15, priority: 100, essential: true },
    tools: { percent: 5, priority: 95, essential: true },
    userRequest: { percent: 10, priority: 90, essential: true },
    conversationHistory: { percent: 25, priority: 50, essential: false },
    projectRules: { percent: 5, priority: 70, essential: true },
    taskState: { percent: 5, priority: 80, essential: true },
    codeContext: { percent: 20, priority: 60, essential: false },
    toolResults: { percent: 10, priority: 40, essential: false },
    responseReserve: { percent: 3, priority: 100, essential: true },
    repairReserve: { percent: 2, priority: 85, essential: true }
  }
};

export class ContextBudgetManager {
  private config: BudgetConfig;
  private allocations: Map<ContextSlot, BudgetAllocation>;
  private slotContents: Map<ContextSlot, string[]>;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allocations = new Map();
    this.slotContents = new Map();
    this.reset();
  }

  public reset(): void {
    this.allocations.clear();
    this.slotContents.clear();

    for (const [slot, settings] of Object.entries(this.config.defaultAllocations)) {
      const typedSlot = slot as ContextSlot;
      this.allocations.set(typedSlot, {
        slot: typedSlot,
        allocatedChars: Math.floor(this.config.totalBudgetChars * (settings.percent / 100)),
        usedChars: 0,
        priority: settings.priority,
        essential: settings.essential
      });
      this.slotContents.set(typedSlot, []);
    }
    logDebug('ContextBudgetManager reset completed');
  }

  public allocate(slot: ContextSlot, content: string): { accepted: boolean; trimmedContent?: string; usedChars: number } {
    const allocation = this.allocations.get(slot);
    if (!allocation) {
        return { accepted: false, usedChars: 0 };
    }

    const usage = this.getUsage();
    const availableTotal = Math.max(0, this.config.totalBudgetChars - usage.used);
    const contentLength = content.length;

    if (contentLength <= availableTotal) {
      allocation.usedChars += contentLength;
      this.slotContents.get(slot)?.push(content);
      return { accepted: true, usedChars: allocation.usedChars };
    }

    if (allocation.essential) {
      // Force allocate if essential
      allocation.usedChars += contentLength;
      this.slotContents.get(slot)?.push(content);
      return { accepted: true, usedChars: allocation.usedChars };
    }

    // Trim content for non-essential slots
    if (availableTotal > 0) {
      const trimmedContent = content.substring(0, availableTotal);
      allocation.usedChars += availableTotal;
      this.slotContents.get(slot)?.push(trimmedContent);
      return { accepted: true, trimmedContent, usedChars: allocation.usedChars };
    }

    return { accepted: false, usedChars: allocation.usedChars };
  }

  public canFit(slot: ContextSlot, contentLength: number): boolean {
    const allocation = this.allocations.get(slot);
    if (!allocation) return false;
    if (allocation.essential) return true;
    
    return (allocation.allocatedChars - allocation.usedChars) >= contentLength;
  }

  public getRemainingBudget(slot?: ContextSlot): number {
    if (slot) {
      const allocation = this.allocations.get(slot);
      if (!allocation) return 0;
      return Math.max(0, allocation.allocatedChars - allocation.usedChars);
    }

    const usage = this.getUsage();
    return Math.max(0, this.config.totalBudgetChars - usage.used);
  }

  public getUsage(): { total: number; used: number; percent: number; slots: BudgetAllocation[] } {
    let used = 0;
    const slots: BudgetAllocation[] = [];

    for (const allocation of this.allocations.values()) {
      used += allocation.usedChars;
      slots.push({ ...allocation });
    }

    return {
      total: this.config.totalBudgetChars,
      used,
      percent: (used / this.config.totalBudgetChars) * 100,
      slots
    };
  }

  public exceedsSoftLimit(): boolean {
    const usage = this.getUsage();
    return usage.used > (this.config.totalBudgetChars * this.config.softLimitPercent);
  }

  public exceedsHardLimit(): boolean {
    const usage = this.getUsage();
    return usage.used > (this.config.totalBudgetChars * this.config.hardLimitPercent);
  }

  public compact(): CompactionResult {
    let removedChars = 0;
    let removedItems = 0;
    const compactedSlots = new Set<ContextSlot>();

    if (!this.exceedsSoftLimit()) {
      return { removedChars, removedItems, compactedSlots: [] };
    }

    // 1. Compact codeContext (replace stale raw code with summaries)
    const codeContextAlloc = this.allocations.get('codeContext');
    const codeContents = this.slotContents.get('codeContext');
    if (codeContextAlloc && codeContents && codeContents.length > 0) {
      for (let i = 0; i < codeContents.length; i++) {
        const content = codeContents[i];
        if (content.length > 500) { 
          const lines = content.split('\n');
          if (lines.length > 10) {
            const summary = [
              ...lines.slice(0, 3),
              '...',
              ...lines.slice(-3)
            ].join('\n');
            const diff = content.length - summary.length;
            removedChars += diff;
            codeContextAlloc.usedChars -= diff;
            codeContents[i] = summary;
            removedItems++;
            compactedSlots.add('codeContext');
          }
        }
      }
    }

    if (!this.exceedsSoftLimit()) {
      return { removedChars, removedItems, compactedSlots: Array.from(compactedSlots) };
    }

    // 2. Trim toolResults (oldest first)
    const toolResultsAlloc = this.allocations.get('toolResults');
    const toolContents = this.slotContents.get('toolResults');
    if (toolResultsAlloc && toolContents && toolContents.length > 0) {
      while (toolContents.length > 0 && this.exceedsSoftLimit()) {
        const removed = toolContents.shift()!;
        removedChars += removed.length;
        toolResultsAlloc.usedChars -= removed.length;
        removedItems++;
        compactedSlots.add('toolResults');
      }
    }

    if (!this.exceedsSoftLimit()) {
      return { removedChars, removedItems, compactedSlots: Array.from(compactedSlots) };
    }
    
    // 3. Trim conversationHistory from oldest
    const historyAlloc = this.allocations.get('conversationHistory');
    const historyContents = this.slotContents.get('conversationHistory');
    if (historyAlloc && historyContents && historyContents.length > 0) {
      while (historyContents.length > 0 && this.exceedsSoftLimit()) {
        const removed = historyContents.shift()!;
        removedChars += removed.length;
        historyAlloc.usedChars -= removed.length;
        removedItems++;
        compactedSlots.add('conversationHistory');
      }
    }

    logInfo(`Compaction complete. Removed ${removedChars} chars in ${removedItems} items.`);

    return {
      removedChars,
      removedItems,
      compactedSlots: Array.from(compactedSlots)
    };
  }

  public removeDuplicateToolOutputs(history: Message[]): Message[] {
    const seenOutputs = new Set<string>();
    const deduplicated: Message[] = [];

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const isToolResult = (msg.role as string) === 'tool' || (Array.isArray(msg.content) && msg.content.some(c => c.type === 'tool_result'));
      if (isToolResult && msg.content) {
        if (Array.isArray(msg.content)) {
          const newBlocks = msg.content.map(block => {
            if (block.type === 'tool_result') {
              const resContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              if (seenOutputs.has(resContent)) {
                return { ...block, content: '[Duplicate tool output omitted]' };
              } else {
                seenOutputs.add(resContent);
                return block;
              }
            }
            return block;
          });
          deduplicated.unshift({ ...msg, content: newBlocks });
          continue;
        } else {
          const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          if (seenOutputs.has(contentStr)) {
            deduplicated.unshift({
              ...msg,
              content: '[Duplicate tool output omitted]'
            });
            continue;
          } else {
            seenOutputs.add(contentStr);
          }
        }
      }
      deduplicated.unshift(msg);
    }
    return deduplicated;
  }

  public replaceStaleContent(slot: ContextSlot, oldId: string, newContent: string): void {
     const contents = this.slotContents.get(slot);
     const allocation = this.allocations.get(slot);
     if (contents && allocation) {
         const index = contents.findIndex(c => c.includes(oldId));
         if (index !== -1) {
             const oldLength = contents[index].length;
             contents[index] = newContent;
             allocation.usedChars = allocation.usedChars - oldLength + newContent.length;
         }
     }
  }
}
