import * as vscode from "vscode";

const MEMORY_STORAGE_KEY = "hooshyar.agentMemory";

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export class MemoryManager {
  private static instance: MemoryManager | null = null;
  private memento: vscode.Memento | null = null;
  private inMemoryFallback: Map<string, MemoryEntry> = new Map();

  private listeners: Array<() => void> = [];

  private constructor() {}

  public static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  public onDidChange(listener: () => void): { dispose: () => void } {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      }
    };
  }

  private notifyChanged(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
  }

  public initialize(memento: vscode.Memento): void {
    this.memento = memento;
  }

  private getEntries(): Record<string, MemoryEntry> {
    if (this.memento) {
      return this.memento.get<Record<string, MemoryEntry>>(MEMORY_STORAGE_KEY, {});
    }
    const result: Record<string, MemoryEntry> = {};
    for (const [k, v] of this.inMemoryFallback.entries()) {
      result[k] = v;
    }
    return result;
  }

  private async saveEntries(entries: Record<string, MemoryEntry>): Promise<void> {
    if (this.memento) {
      await this.memento.update(MEMORY_STORAGE_KEY, entries);
    } else {
      this.inMemoryFallback.clear();
      for (const [k, v] of Object.entries(entries)) {
        this.inMemoryFallback.set(k, v);
      }
    }
  }

  public async store(key: string, value: string): Promise<void> {
    const cleanKey = key.trim();
    const cleanValue = value.trim();
    if (!cleanKey || !cleanValue) {
      throw new Error("Both key and value are required to store in memory.");
    }
    const entries = this.getEntries();
    entries[cleanKey] = {
      key: cleanKey,
      value: cleanValue,
      updatedAt: new Date().toISOString()
    };
    await this.saveEntries(entries);
    this.notifyChanged();
  }

  public recall(key: string): string | undefined {
    const cleanKey = key.trim();
    const entries = this.getEntries();
    return entries[cleanKey]?.value;
  }

  public async delete(key: string): Promise<boolean> {
    const cleanKey = key.trim();
    const entries = this.getEntries();
    if (entries[cleanKey]) {
      delete entries[cleanKey];
      await this.saveEntries(entries);
      this.notifyChanged();
      return true;
    }
    return false;
  }

  public list(): Record<string, string> {
    const entries = this.getEntries();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      result[k] = v.value;
    }
    return result;
  }

  public async clear(): Promise<void> {
    await this.saveEntries({});
    this.notifyChanged();
  }

  public formatForSystemPrompt(): string {
    const items = Object.entries(this.list());
    if (items.length === 0) return "";

    const lines = items.map(([key, val]) => `- **${key}**: ${val}`);
    return (
      `## DEVELOPER PERSISTENT PREFERENCES & MEMORY\n` +
      `The user previously requested the following persistent preferences across projects and sessions. Respect them:\n` +
      lines.join("\n") +
      `\n\n`
    );
  }
}
