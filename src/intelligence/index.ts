/**
 * Intelligence Layer - Barrel Export
 *
 * Provides symbol-first retrieval, dependency-aware context expansion,
 * context ranking, budget management, incremental indexing, validation,
 * and task working memory for large codebase intelligence.
 */

export {
  AgentRuntime,
  getAgentRuntime,
  type IntentAnalysis,
  type AgentContext,
  type PostEditResult
} from "./agentRuntime";

export {
  CodebaseIntelligence,
  type SymbolInfo,
  type SymbolRef,
  type FileOutline
} from "./codebaseIntelligence";

export {
  ContextBudgetManager,
  type ContextSlot,
  type BudgetAllocation,
  type BudgetConfig
} from "./contextBudgetManager";

export {
  ContextRanker,
  type RankedContextItem,
  type RelevanceSignal,
  type RankingConfig
} from "./contextRanker";

export {
  IncrementalIndexer,
  getIncrementalIndexer,
  type IndexedFileEntry,
  type IndexChangeEvent
} from "./incrementalIndexer";

export {
  RetrievalEngine,
  type RetrievalRequest,
  type RetrievalResult
} from "./retrievalEngine";

export {
  TaskMemoryManager,
  getTaskMemoryManager,
  type TaskMemory,
  type TaskDecision,
  type SymbolEdit
} from "./taskMemory";

export {
  ValidationEngine,
  type ValidationResult,
  type DiagnosticItem,
  type ImpactAnalysis
} from "./validationEngine";

export {
  IntelligenceObserver,
  type MetricEntry,
  type OperationTrace
} from "./observability";

export {
  getSymbolTool,
  getFileOutlineTool,
  findCallersTool,
  findDependenciesTool,
  getRelatedTestsTool,
  getProjectMapTool,
  type GetSymbolInput
} from "./symbolTools";
