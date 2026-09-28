/**
 * AgentRuntime – Orchestrates intelligence services for the agent execution loop.
 *
 * Provides a facade that ChatViewProvider (and future callers) use instead of
 * directly invoking individual intelligence sub-systems.  Responsibilities:
 *
 *  1. Pre-retrieval: Analyse the user intent + locate primary symbols
 *  2. Context assembly: Rank, budget-limit, and deduplicate context items
 *  3. Post-edit: Re-index modified files, validate, run diagnostics
 *  4. Working memory: Maintain structured task state across turns
 *  5. Observability: Record metrics for debugging / tuning
 */

import * as vscode from "vscode";
import {
  CodebaseIntelligence,
  type SymbolInfo
} from "./codebaseIntelligence";
import { ContextRanker } from "./contextRanker";
import { ContextBudgetManager } from "./contextBudgetManager";
import { getIncrementalIndexer } from "./incrementalIndexer";
import { RetrievalEngine, type RetrievalRequest, type RetrievalResult } from "./retrievalEngine";
import { getTaskMemoryManager } from "./taskMemory";
import { ValidationEngine, type DiagnosticItem } from "./validationEngine";
import { IntelligenceObserver } from "./observability";

// ─── Public interfaces ───────────────────────────────────────────────

export interface IntentAnalysis {
  /** Natural-language summary of what the user wants */
  goal: string;
  /** Likely primary symbols / identifiers extracted from the request */
  primarySymbols: string[];
  /** Files explicitly mentioned */
  mentionedFiles: string[];
  /** Whether the request implies a code change (vs. informational) */
  isEditIntent: boolean;
  /** Whether the request mentions tests */
  mentionsTests: boolean;
  /** Whether the request mentions config / settings */
  mentionsConfig: boolean;
}

export interface AgentContext {
  /** Compact code context for the LLM (already ranked + budgeted) */
  codeContext: string;
  /** The primary symbols resolved */
  primarySymbols: SymbolInfo[];
  /** Files that should be watched for changes */
  relevantFiles: string[];
  /** Impact analysis summary (if changing public API) */
  impactSummary?: string;
  /** Task working memory summary */
  taskMemorySummary?: string;
  /** Project map excerpt */
  projectMap?: string;
  /** Retrieval metrics */
  retrievalTimeMs: number;
  /** Token count of the code context */
  contextTokens: number;
}

export interface PostEditResult {
  /** Diagnostics found after editing */
  diagnostics: DiagnosticItem[];
  /** Whether errors were introduced */
  hasErrors: boolean;
  /** Formatted diagnostic summary for the LLM */
  diagnosticSummary: string;
  /** Files that were re-indexed */
  reindexedFiles: string[];
  /** Updated impact information */
  impactSummary?: string;
}

// ─── AgentRuntime ────────────────────────────────────────────────────

export class AgentRuntime implements vscode.Disposable {
  private readonly ranker = new ContextRanker();
  private readonly budgetManager: ContextBudgetManager;
  private readonly validationEngine = new ValidationEngine();
  private retrievalEngine: RetrievalEngine | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(totalBudgetChars?: number) {
    const budget = totalBudgetChars ??
      vscode.workspace.getConfiguration("hooshyar").get<number>("maxContextChars", 160_000);
    this.budgetManager = new ContextBudgetManager({ totalBudgetChars: budget });
  }

  // ── Lazy init (avoids blocking activation) ──────────────────────

  private ensureRetrievalEngine(): RetrievalEngine {
    if (!this.retrievalEngine) {
      this.retrievalEngine = new RetrievalEngine(
        CodebaseIntelligence.getCodebaseIntelligence(),
        this.ranker,
        getIncrementalIndexer()
      );
    }
    return this.retrievalEngine;
  }

  // ── 1. Intent Analysis ──────────────────────────────────────────

  /**
   * Lightweight heuristic analysis of the user's request.
   * Does NOT call any language service – runs in < 1 ms.
   */
  analyseIntent(userMessage: string): IntentAnalysis {
    const lower = userMessage.toLowerCase();

    // Edit intent keywords (EN + FA)
    const editPatterns = [
      /\b(add|create|implement|write|fix|bug|refactor|update|change|modify|edit|remove|delete|patch|replace)\b/i,
      /(اضافه|ایجاد|بساز|بنویس|تغییر|ویرایش|اصلاح|رفع|حذف|پاک|بازنویسی)/
    ];
    const isEditIntent = editPatterns.some(p => p.test(userMessage));

    const mentionsTests = /\b(tests?|specs?|jest|mocha|pytest|vitest|تست)\b/i.test(lower);
    const mentionsConfig = /\b(config|setting|env|environment|تنظیم|پیکربندی)\b/i.test(lower);

    const primarySymbols = this.extractSymbolCandidates(userMessage);
    const mentionedFiles = this.extractFilePaths(userMessage);

    return {
      goal: userMessage.slice(0, 200),
      primarySymbols,
      mentionedFiles,
      isEditIntent,
      mentionsTests,
      mentionsConfig
    };
  }

  // ── 2. Smart Context Retrieval ──────────────────────────────────

  /**
   * Retrieve minimal, dependency-aware context for a user request.
   *
   * This replaces the old "read many files → dump raw content" workflow
   * with targeted symbol-level retrieval.
   */
  async retrieveContext(request: RetrievalRequest): Promise<AgentContext> {
    const trace = IntelligenceObserver.getObserver().startTrace("agentRuntime.retrieveContext", {
      query: request.query?.slice(0, 100)
    });

    try {
      const engine = this.ensureRetrievalEngine();
      const result: RetrievalResult = await engine.retrieve(request);

      // Build compact code context string from ranked items
      const contextParts: string[] = [];
      let totalTokens = 0;
      const relevantFiles: string[] = [];

      for (const item of result.items) {
        const header = item.symbolName
          ? `### ${item.symbolName} (${item.file}${item.startLine ? `:${item.startLine}` : ""})`
          : `### ${item.file}`;
        const block = `${header}\n\`\`\`\n${item.content}\n\`\`\``;
        totalTokens += item.estimatedTokens;
        contextParts.push(block);
        if (!relevantFiles.includes(item.file)) {
          relevantFiles.push(item.file);
        }
      }

      // Add related tests summary
      if (result.relatedTests.length > 0) {
        contextParts.push(`\n### Related Tests\n${result.relatedTests.map(t => `- ${t}`).join("\n")}`);
      }

      // Add dependencies summary
      if (result.dependencies.length > 0) {
        const depSummary = result.dependencies
          .slice(0, 10)
          .map(d => `- ${d.name} (${d.file}:${d.startLine})`)
          .join("\n");
        contextParts.push(`\n### Dependencies\n${depSummary}`);
      }

      // Add callers summary
      if (result.callers.length > 0) {
        const callerSummary = result.callers
          .slice(0, 8)
          .map(c => `- ${c.name} (${c.file}:${c.startLine})`)
          .join("\n");
        contextParts.push(`\n### Callers / References\n${callerSummary}`);
      }

      const codeContext = contextParts.join("\n\n");

      // Update task memory
      const taskMem = getTaskMemoryManager();
      if (!taskMem.getActiveTask()) {
        taskMem.createTask(request.taskGoal ?? request.query);
      }
      for (const sym of result.primarySymbols) {
        taskMem.addRelevantSymbol(sym.name, {
          file: sym.file,
          startLine: sym.startLine,
          endLine: sym.endLine
        });
      }
      for (const f of relevantFiles) {
        taskMem.markFileInspected(f);
      }

      // Get task memory summary
      const taskMemorySummary = taskMem.getActiveTask()
        ? taskMem.toCompactSummary()
        : undefined;

      // Get compact project map
      const indexer = getIncrementalIndexer();
      const projectMap = indexer.getProjectMap(3);

      // Record metrics
      IntelligenceObserver.getObserver().recordMetric("context.items_selected", result.items.length, "count");
      IntelligenceObserver.getObserver().recordMetric("context.tokens_used", totalTokens, "tokens");
      IntelligenceObserver.getObserver().recordMetric("retrieval.duration", result.retrievalTimeMs, "ms");

      return {
        codeContext,
        primarySymbols: result.primarySymbols,
        relevantFiles,
        taskMemorySummary,
        projectMap: projectMap.length < 3000 ? projectMap : projectMap.slice(0, 3000) + "\n...(truncated)",
        retrievalTimeMs: result.retrievalTimeMs,
        contextTokens: totalTokens
      };
    } finally {
      IntelligenceObserver.getObserver().endTrace(trace);
    }
  }

  // ── 3. Post-Edit Validation ─────────────────────────────────────

  /**
   * After the agent edits files, re-index and validate.
   * Returns diagnostics that should be fed back to the LLM for repair.
   */
  async postEditValidation(modifiedFiles: string[]): Promise<PostEditResult> {
    const trace = IntelligenceObserver.getObserver().startTrace("agentRuntime.postEditValidation", {
      files: modifiedFiles.length
    });

    try {
      // Re-index modified files
      const intelligence = CodebaseIntelligence.getCodebaseIntelligence();
      const reindexedFiles: string[] = [];
      for (const file of modifiedFiles) {
        try {
          // Invalidate caches so future reads see the current version
          intelligence.invalidateFile(file);
          reindexedFiles.push(file);
        } catch {
          // File might have been deleted
        }
      }

      // Update task memory
      const taskMem = getTaskMemoryManager();
      for (const file of modifiedFiles) {
        taskMem.trackFileModification(file, "", "modified");
      }

      // Get diagnostics
      const validation = await this.validationEngine.validateFiles(modifiedFiles);

      // Format for LLM
      const diagnosticSummary = validation.errors.length > 0
        ? this.validationEngine.formatDiagnosticsForLLM(
            [...validation.errors, ...validation.warnings],
            15
          )
        : "";

      if (validation.errors.length > 0) {
        taskMem.clearValidationFailures();
        for (const err of validation.errors.slice(0, 5)) {
          taskMem.addValidationFailure(`${err.file}:${err.line}: ${err.message}`);
        }
      }

      IntelligenceObserver.getObserver().recordMetric("validation.duration",
        trace.startTime ? Date.now() - trace.startTime : 0, "ms");
      IntelligenceObserver.getObserver().recordMetric("validation.repair_iterations", 0, "count");

      return {
        diagnostics: [...validation.errors, ...validation.warnings],
        hasErrors: validation.errors.length > 0,
        diagnosticSummary,
        reindexedFiles
      };
    } finally {
      IntelligenceObserver.getObserver().endTrace(trace);
    }
  }

  // ── 4. Impact Analysis ──────────────────────────────────────────

  /**
   * Before editing a public symbol, check callers/references/tests.
   */
  async analyzeEditImpact(
    file: string,
    symbolName: string
  ): Promise<string> {
    try {
      const impact = await this.validationEngine.analyzeImpact(file, symbolName);

      if (!impact.isPublicApi) {
        return "";
      }

      const parts: string[] = [
        `⚠️ Impact Analysis for ${symbolName} (risk: ${impact.breakingChangeRisk})`
      ];

      if (impact.callers.length > 0) {
        parts.push(`Callers (${impact.callers.length}): ${impact.callers.slice(0, 5).map(c => `${c.name}@${c.file}`).join(", ")}`);
      }
      if (impact.references.length > 0) {
        parts.push(`References: ${impact.references.length} locations`);
      }
      if (impact.tests.length > 0) {
        parts.push(`Related tests: ${impact.tests.join(", ")}`);
      }

      return parts.join("\n");
    } catch {
      return "";
    }
  }

  // ── 5. Exploration Policy ───────────────────────────────────────

  /**
   * Determine whether additional broad search is warranted.
   * Returns false if the agent has already done enough discovery.
   */
  shouldContinueExploring(
    depth: number,
    broadSearchCount: number,
    fullFileReadCount: number,
    symbolRetrievalCount: number
  ): { allowed: boolean; guidance: string } {
    // After discovery, switch to targeted operations
    if (broadSearchCount >= 3 && symbolRetrievalCount === 0) {
      return {
        allowed: false,
        guidance: "[GUIDANCE: You have performed multiple broad searches. Use find_symbol, find_definition, or find_references for targeted lookup instead of another broad search.]"
      };
    }

    if (fullFileReadCount >= 5 && depth < 4) {
      return {
        allowed: true,
        guidance: "[GUIDANCE: You have read several full files. Prefer get_document_symbols or find_symbol for targeted symbol retrieval rather than reading entire files.]"
      };
    }

    if (depth >= 6 && broadSearchCount > 2) {
      return {
        allowed: false,
        guidance: "[GUIDANCE: Discovery phase should be complete. Please proceed with edits or provide your response.]"
      };
    }

    return { allowed: true, guidance: "" };
  }

  // ── 6. Session Cache ────────────────────────────────────────────

  /**
   * Check if a search result is already cached.
   */
  getCachedResult(query: string): string | undefined {
    return getTaskMemoryManager().getCachedSearchResult(query);
  }

  /**
   * Cache a search result.
   */
  cacheResult(query: string, result: string): void {
    getTaskMemoryManager().cacheSearchResult(query, result);
  }

  // ── 7. Stale Context Tracking ───────────────────────────────────

  /**
   * Invalidate context for a modified file.
   */
  invalidateFileContext(filePath: string): void {
    try {
      CodebaseIntelligence.getCodebaseIntelligence().invalidateFile(filePath);
    } catch {
      // Best effort
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private extractSymbolCandidates(text: string): string[] {
    const candidates: string[] = [];

    // PascalCase / camelCase identifiers (likely class/function names)
    const identifierPattern = /\b([A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?)\b/g;
    let match;
    while ((match = identifierPattern.exec(text)) !== null) {
      const candidate = match[1];
      // Filter out common English words that happen to be capitalized
      const stopWords = new Set([
        "The", "This", "That", "These", "Those", "What", "When", "Where",
        "Which", "Who", "How", "Can", "Could", "Would", "Should", "Will",
        "May", "Must", "Find", "Add", "Create", "Make", "Build", "Get",
        "Set", "Delete", "Remove", "Update", "Change", "Fix", "New",
        "Use", "Using", "With", "From", "Into", "About", "After", "Before",
        "Please", "Help", "Show", "Tell", "Give", "Take", "Put"
      ]);
      if (!stopWords.has(candidate) && candidate.length > 2) {
        candidates.push(candidate);
      }
    }

    // Quoted strings are explicit lookups
    const quotedPattern = /["'`]([A-Za-z_]\w*(?:\.\w+)?)["'`]/g;
    while ((match = quotedPattern.exec(text)) !== null) {
      candidates.push(match[1]);
    }

    // Deduplicate
    return [...new Set(candidates)];
  }

  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    // Match file-path-like strings
    const pathPattern = /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w{1,10})\b/g;
    let match;
    while ((match = pathPattern.exec(text)) !== null) {
      paths.push(match[1]);
    }
    return [...new Set(paths)];
  }

  // ── Disposal ────────────────────────────────────────────────────

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/** Shared singleton instance. */
let _runtimeInstance: AgentRuntime | undefined;

export function getAgentRuntime(): AgentRuntime {
  if (!_runtimeInstance) {
    _runtimeInstance = new AgentRuntime();
  }
  return _runtimeInstance;
}
