# Hooshyar Agent Architecture Progress

This document tracks the staged implementation of the advanced agent architecture. Status values are limited to `NOT_STARTED`, `IN_PROGRESS`, `PARTIAL`, `DONE`, and `BLOCKED`.

## Baseline

- Baseline date: 2026-09-25
- Baseline tests: 104 passing
- Provider support: Anthropic-compatible and OpenAI-compatible
- Existing features are migrated through adapters before their implementations are split into dedicated modules.

## Foundation

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Tool Registry | DONE | `src/tools/registry.ts`, `src/tools/createRegistry.ts` | `test/agentFoundation.test.mjs` | Built-in implementations remain in legacy `src/tools.ts` behind the registry adapter. |
| Dynamic built-in and MCP registration | DONE | MCP definitions are registered per agent turn | Registry and MCP regression tests | Skills currently provide instructions, not executable tools. |
| Tool permissions and risk metadata | DONE | Category, risk, parallel safety, enabled state | Classification tests | Fine-grained MCP permissions are name-based until MCP metadata supports annotations. |
| Tool cancellation, timeout, result limits | DONE | Per-invocation linked abort signal, timeout, truncation | Registry timeout/truncation tests | Large-result persistent handles are a later phase. |
| Tool telemetry abstraction | PARTIAL | Metadata-only callback; no content or secrets logged | Registry event test | No opt-in analytics sink yet. |
| Structured errors | DONE | `src/errors.ts` | Registry error assertions | Provider and indexing errors will migrate incrementally. |
| Agent state machine | PARTIAL | `src/agent/agentState.ts`, core loop transitions | State transition tests | Legacy UI booleans remain during webview migration. |
| Context Engine | PARTIAL | Ranked token-budget selection in `src/context/contextEngine.ts` | Context budget tests | Existing context collectors are not all providers yet. |
| Central Approval Engine | PARTIAL | `src/approvalEngine.ts`, workspace trust gate, existing policy adapter | Existing approval regressions | Approval card rendering remains owned by ChatViewProvider. |
| Model capabilities | PARTIAL | `src/modelCapabilities.ts` | Capability tests | Static inference; active provider probing is not implemented. |

## Code Intelligence

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Symbol tools | DONE | `src/symbolIntelligence.ts` (8 tools) | `test/codeIntelligence.test.mjs` | None |
| Incremental workspace index | DONE | `src/codeIndex/workspaceCodeIndex.ts`, `src/codeIndex/chunker.ts` | `test/codeIntelligence.test.mjs` | Embeddings opt-in |
| Semantic and hybrid search | DONE | `src/codeIndex/hybridSearch.ts`, `src/codeIndex/embeddingProvider.ts` | `test/codeIntelligence.test.mjs` | BM25 deferred |
| Code graph | DONE | `src/codeIndex/codeGraph.ts`, `src/codeIndex/codeGraphTools.ts` (3 tools) | `test/projectProfile.test.mjs` | Call hierarchy pending |
| Project profile | DONE | `src/projectProfile/` (5 modules) | `test/projectProfile.test.mjs` | 24-hour cache |

## Agent Architecture

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Planner agent | DONE | `src/agent/planner.ts` | Manual verification | Heuristic decomposition only |
| Search agent | DONE | `src/agent/searchAgent.ts` | Manual verification | Uses project profile and code graph |
| Execution agent | DONE | `src/agent/executionAgent.ts` | Manual verification | 120s timeout default |
| Verification agent | DONE | `src/agent/verificationAgent.ts` | Manual verification | Auto-fix patterns limited |
| Context isolation | DONE | `src/agent/contextIsolation.ts` provides bounded per-agent contexts | Phase 3-6 integration tests | Context is filtered and budgeted before delegation. |

## Transactions and Safety

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| ChangeSet transactions | DONE | `src/changeSet/changeSetManager.ts` | Manual verification | Hash-based conflict detection |
| Rollback support | DONE | ChangeSetManager rollback method | Manual verification | Requires applied state |
| Self-repair pipeline | DONE | `src/changeSet/selfRepair.ts` | Manual verification | Max 3 attempts, limited auto-fix |
| Conflict detection | DONE | Hash comparison before apply | Manual verification | Content-based only |

## Native Integration

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Test framework detection | DONE | `src/testing/testFrameworkDetector.ts` | Manual verification | 5 frameworks supported |
| Test result parsing | DONE | `src/testing/testResultParser.ts` | Manual verification | Framework-specific parsers |
| Task integration | DONE | `src/taskIntegration/taskProvider.ts` | Manual verification | Common templates only |
| Terminal manager | DONE | `src/terminal/terminalManager.ts` | Manual verification | Named terminal pooling |

## Agent Architecture

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Planner | DONE | `src/agent/planner.ts`, persisted revision-aware plans | Agent integration tests | Heuristic decomposition is intentionally deterministic. |
| Search Subagent | DONE | `src/agent/searchAgent.ts`, isolated profile/graph-aware search and cache | Phase 3-6 integration tests | Cache is session-bound. |
| Execution Subagent | DONE | `src/agent/executionAgent.ts`, bounded command execution and structured test parsing | Agent/native integration tests | 120s default timeout. |
| Verification Agent | DONE | `src/agent/verificationAgent.ts`, diagnostics, test execution, quick fixes | Phase 3-6 integration tests | Only deterministic VS Code quick fixes are applied. |
| Context isolation | DONE | `src/agent/contextIsolation.ts` | Phase 3-6 integration tests | Context is explicitly budgeted. |

## Reliability And Product

| Feature | Status | Implementation | Tests | Known limitations |
| --- | --- | --- | --- | --- |
| Patch edit engine | DONE | ChangeSet-backed `write_file`, `search_replace`, backup, diff, revert | ChangeSet integration tests | Multi-file operations use `apply_changeset`. |
| Test runner | DONE | Framework detector, structured parser, Test Explorer, and verification agent | Agent/native integration tests | Five framework families are supported. |
| Session state | PARTIAL | Persistent chat/task/usage sessions | Existing session behavior | Structured checkpoints remain future work. |
| Agent timeline and tool cards | PARTIAL | Collapsible activity UI | Manual webview verification | Context inspector and debug panel are pending. |
| Security | PARTIAL | approvals, command guards, SecretStorage, trust gate | Approval and command safety tests | Secret scanning and policy audit UI are pending. |

## Migration Order

1. Foundation and adapters.
2. Symbol intelligence and incremental indexing.
3. Hybrid retrieval and project profile.
4. Planner, search, execution, and verification agents.
5. ChangeSet transactions and self-repair.
6. Native test/task/terminal integration.
7. Editor intelligence and product UX.
8. Extensibility and optional advanced agents.
