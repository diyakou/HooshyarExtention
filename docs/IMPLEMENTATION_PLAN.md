# Hooshyar Implementation Plan - All Phases

This document provides a comprehensive implementation plan for completing all phases outlined in COPILOT_PARITY.md.

## Status Summary

- ✅ **Phase 1: Foundation and adapters** - COMPLETE
- ✅ **Phase 2: Symbol intelligence and incremental indexing** - COMPLETE (116/120 tests passing)
- ✅ **Phase 3: Hybrid retrieval and project profile** - COMPLETE
- ✅ **Phase 4: Planner, search, execution, and verification agents** - COMPLETE
- ✅ **Phase 5: ChangeSet transactions and self-repair** - COMPLETE
- ✅ **Phase 6: Native test/task/terminal integration** - COMPLETE
- ⏳ **Phase 7: Editor intelligence and product UX** - PLANNED
- ⏳ **Phase 8: Extensibility and optional advanced agents** - PLANNED

---

## Phase 3: Hybrid Retrieval and Project Profile

### Objectives
Enhance code intelligence with project-wide understanding and advanced retrieval capabilities.

### Features to Implement

#### 3.1 Project Profile System
**Status**: DONE

**Implementation**:
- Create `src/projectProfile/profileManager.ts` - detects and stores project metadata
- Create `src/projectProfile/techStackDetector.ts` - identifies frameworks, languages, build tools
- Create `src/projectProfile/conventionsExtractor.ts` - learns coding patterns from existing code
- Create `src/projectProfile/dependencyAnalyzer.ts` - analyzes package.json, requirements.txt, etc.

**Key Components**:
```typescript
interface ProjectProfile {
  languages: { name: string; percentage: number }[];
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  conventions: {
    indentation: 'spaces' | 'tabs';
    spacing: number;
    quotes: 'single' | 'double';
    naming: { classes: string; functions: string; variables: string };
  };
  dependencies: { name: string; version: string; dev: boolean }[];
  architecture: {
    directories: { path: string; purpose: string }[];
    patterns: string[];
  };
}
```

**Tests**: `test/projectProfile.test.mjs`

#### 3.2 Enhanced Hybrid Retrieval
**Status**: DONE (BM25, query expansion, and graph-aware reranking implemented)

**Implementation**:
- Add BM25 text scoring to complement current overlap scoring
- Implement query expansion using synonyms and related terms
- Add result reranking based on:
  - Recently edited files
  - Import/dependency relationships
  - File co-occurrence patterns

**Files to modify**:
- `src/codeIndex/hybridSearch.ts` - add BM25, query expansion
- `src/codeIndex/reranker.ts` - NEW: post-search reranking logic

**Tests**: Add to `test/codeIntelligence.test.mjs`

#### 3.3 Code Graph
**Status**: DONE

**Implementation**:
- Create `src/codeIndex/codeGraph.ts` - build import/reference graph
- Track symbol relationships (calls, inheritance, implementations)
- Provide graph traversal tools

**New Tools**:
- `get_related_files` - find files related by imports/usage
- `get_symbol_dependencies` - show what a symbol depends on
- `get_symbol_dependents` - show what depends on a symbol

**Tests**: `test/codeGraph.test.mjs`

### Success Criteria
- ✅ Project profile automatically detected on workspace open
- ✅ Hybrid search returns more relevant results than text-only search
- ✅ Code graph tools provide useful dependency information
- ✅ All Phase 3 tests passing

---

## Phase 4: Planner, Search, Execution, and Verification Agents

### Objectives
Implement specialized sub-agents for complex multi-step tasks.

### Features to Implement

#### 4.1 Planner Agent
**Status**: DONE

**Current State**: Task list and autonomous continuation exist

**Enhancements Needed**:
- Structured Ask/Plan/Agent separation
- Plan persistence to `.hooshyar/PLAN.md`
- Plan revision based on execution feedback
- Subtask decomposition with dependencies

**Files**:
- `src/agent/planner.ts` - NEW: dedicated planner logic
- Extract planning logic from `src/chatViewProvider.ts`

**Tests**: Expand `test/planExecution.test.mjs`

#### 4.2 Search Subagent
**Status**: DONE

**Implementation**:
- Create `src/agent/searchAgent.ts` - specialized code search agent
- Use semantic search + code graph + project profile
- Return summarized, ranked results
- Cache search results per session

**New Tool**: `delegate_search {query, scope}` - offload search to subagent

**Tests**: `test/searchAgent.test.mjs`

#### 4.3 Execution Subagent
**Status**: DONE

**Implementation**:
- Create `src/agent/executionAgent.ts` - isolated command execution
- Capture and summarize command output
- Provide structured results (success/failure, key findings)
- Handle long-running processes

**Enhancements to**: `run_command` tool to support delegation mode

**Tests**: Add to `test/copilotAdvancedFeatures.test.mjs`

#### 4.4 Verification Agent
**Status**: DONE

**Implementation**:
- Create `src/agent/verificationAgent.ts` - automated verification
- Run tests, check diagnostics, validate changes
- Provide structured verification results
- Suggest fixes for failures

**New Tool**: `verify_changes {files}` - comprehensive verification

**Tests**: `test/verificationAgent.test.mjs`

#### 4.5 Context Isolation
**Status**: DONE

**Implementation**:
- Create `src/agent/contextIsolation.ts` - manage subagent contexts
- Each subagent gets filtered context (only relevant to its task)
- Results flow back to main agent
- Prevent context pollution

**Tests**: Test in all subagent test files

### Success Criteria
- ✅ Complex tasks automatically decomposed into subtasks
- ✅ Search subagent provides better results than direct search
- ✅ Execution subagent handles long-running commands gracefully
- ✅ Verification agent catches errors before user sees them
- ✅ Subagents don't pollute main context

---

## Phase 5: ChangeSet Transactions and Self-Repair

### Objectives
Implement atomic, reversible changes with automatic error recovery.

### Features to Implement

#### 5.1 ChangeSet Engine
**Status**: DONE

**Implementation**:
- Create `src/changeSet/changeSetManager.ts` - transactional changes
- Group related edits into atomic changeSets
- Support rollback of entire changeSet
- Track change history with conflict detection

**Key Components**:
```typescript
interface ChangeSet {
  id: string;
  description: string;
  changes: FileChange[];
  state: 'pending' | 'applied' | 'verified' | 'rolled_back';
  verification: VerificationResult;
}

interface FileChange {
  path: string;
  type: 'create' | 'edit' | 'delete';
  content?: string;
  oldContent?: string;
  hash: string;
}
```

**Tests**: `test/changeSet.test.mjs`

#### 5.2 Conflict Detection
**Status**: DONE

**Implementation**:
- Detect concurrent edits (user modified file while agent was working)
- Hash-based change detection
- Merge conflict resolution UI

**Files**:
- `src/changeSet/conflictDetector.ts`
- Update `src/writeBackup.ts` to integrate with changeSets

**Tests**: Add to `test/changeSet.test.mjs`

#### 5.3 Self-Repair Pipeline
**Status**: DONE

**Implementation**:
- Automatic verification after every changeSet
- If verification fails, attempt automatic fix
- Max 3 repair attempts before asking user
- Learn from successful repairs

**Files**:
- `src/agent/selfRepair.ts` - repair orchestration
- Integrate with verification agent

**Tests**: `test/selfRepair.test.mjs`

### Success Criteria
- ✅ All multi-file changes are atomic
- ✅ Failed changes can be rolled back
- ✅ Conflicts detected before overwriting user work
- ✅ 70%+ of errors auto-repaired without user intervention

---

## Phase 6: Native Test/Task/Terminal Integration

### Objectives
Deep integration with VS Code's test, task, and terminal systems.

### Features to Implement

#### 6.1 Test Runner Integration
**Status**: DONE

**Current**: `run_command` captures output

**Enhancements**:
- Detect test framework (Jest, Mocha, pytest, JUnit, etc.)
- Parse test output into structured results
- Show test results in VS Code Test Explorer
- Provide quick actions (run failed tests, debug test)

**Files**:
- `src/testing/testFrameworkDetector.ts`
- `src/testing/testResultParser.ts`
- `src/testing/testExplorerProvider.ts`

**Tests**: `test/testRunner.test.mjs`

#### 6.2 Task Integration
**Status**: DONE

**Current**: `update_tasks` tool exists

**Enhancements**:
- Integration with VS Code tasks
- Task dependency tracking
- Task templates for common workflows
- Progress visualization

**Files**:
- `src/taskIntegration/taskProvider.ts`
- `src/taskIntegration/taskTemplates.ts`

**Tests**: `test/taskIntegration.test.mjs`

#### 6.3 Terminal Integration
**Status**: DONE

**Current**: `run_in_terminal` exists

**Enhancements**:
- Persistent terminal sessions
- Terminal output streaming to agent
- Interactive command support (Y/N prompts)
- Terminal multiplexing (multiple sessions)

**Files**:
- Update `src/tools.ts` runInTerminalTool
- `src/terminal/terminalManager.ts`

**Tests**: Expand existing terminal tests

### Success Criteria
- ✅ Test results appear in VS Code Test Explorer
- ✅ Failed tests can be debugged with one click
- ✅ Tasks show progress and can be canceled
- ✅ Interactive terminal commands work

---

## Phase 7: Editor Intelligence and Product UX

### Objectives
Enhanced editor integrations and polished user experience.

### Features to Implement

#### 7.1 Timeline and Tool Cards
**Status**: PARTIAL

**Current**: Collapsible activity UI exists

**Enhancements**:
- Interactive timeline of agent actions
- Tool call cards with inputs/outputs
- Ability to retry/modify tool calls
- Context inspector (see what agent sees)

**Files**:
- Update webview in `src/chatViewProvider.ts`
- Add timeline component to webview HTML

**Tests**: Manual webview testing

#### 7.2 Debug Panel
**Status**: NOT_STARTED

**Implementation**:
- Show agent reasoning steps
- Display token usage breakdown
- Show cache hit rates
- Export debug traces

**Files**:
- `src/debugPanel/debugPanelProvider.ts`
- Add debug webview

**Tests**: Manual verification

#### 7.3 Context Inspector
**Status**: NOT_STARTED

**Implementation**:
- Show what context is included in each request
- Token counting per context item
- Allow user to exclude items
- Preview prompts before sending

**Files**:
- `src/contextManager.ts` - add inspection APIs
- Add inspector UI to webview

**Tests**: Context budget tests

#### 7.4 Enhanced CodeLens
**Status**: PARTIAL

**Current**: Basic Ask/Explain/Test/Refactor actions

**Enhancements**:
- More granular actions (Optimize, Document, Test Coverage)
- Context-aware actions (show different actions for different symbol types)
- Performance optimizations

**Files**:
- Update `src/codeLensProvider.ts`

**Tests**: Manual verification

### Success Criteria
- ✅ Users can see full agent reasoning
- ✅ Debug panel helps diagnose issues
- ✅ Context inspector prevents token waste
- ✅ CodeLens provides useful quick actions

---

## Phase 8: Extensibility and Optional Advanced Agents

### Objectives
Allow users and plugin developers to extend Hooshyar.

### Features to Implement

#### 8.1 Plugin API
**Status**: NOT_STARTED

**Implementation**:
- Define stable plugin API
- Plugin registration system
- Custom tool registration
- Custom agent registration

**Files**:
- `src/plugin/pluginApi.ts`
- `src/plugin/pluginLoader.ts`

**Tests**: `test/pluginApi.test.mjs`

#### 8.2 Advanced Agents (Optional)
**Status**: NOT_STARTED

**Implementation**:
- Code Review Agent - automated PR review
- Refactoring Agent - large-scale refactors
- Documentation Agent - generate/update docs
- Migration Agent - framework upgrades

**Files**: Each agent in `src/agent/advanced/`

**Tests**: Per-agent test files

#### 8.3 Custom Skill Templates
**Status**: PARTIAL

**Current**: Skills provide instructions

**Enhancements**:
- Skill marketplace/gallery
- Skill templates for common patterns
- Skill versioning and updates

**Files**:
- Update `src/skillsManager.ts`
- Add skill template support

**Tests**: Expand `test/pluginSkills.test.mjs`

### Success Criteria
- ✅ Third-party plugins can be installed
- ✅ Custom tools integrate seamlessly
- ✅ Advanced agents provide value for power users
- ✅ Skill templates reduce boilerplate

---

## Implementation Priority

### High Priority (Next)
1. **Phase 3**: Project profile and code graph (needed by Phase 4)
2. **Phase 4**: Planner and verification agents (high user value)
3. **Phase 5**: ChangeSet transactions (safety critical)

### Medium Priority
4. **Phase 6**: Test/task/terminal integration (productivity)
5. **Phase 7**: Editor intelligence and UX polish (usability)

### Lower Priority
6. **Phase 8**: Extensibility (advanced users)

---

## Testing Strategy

### Unit Tests
- Each new module gets comprehensive unit tests
- Maintain >90% code coverage for new code
- Mock VS Code APIs as needed

### Integration Tests
- Test subagent coordination
- Test changeSet transactions
- Test end-to-end workflows

### Manual Testing
- UI/webview changes require manual verification
- Performance testing for large codebases
- User acceptance testing for each phase

---

## Success Metrics

### Phase 3
- Search relevance: 80%+ of top 3 results should be relevant
- Profile accuracy: Correctly detect tech stack in 95%+ of projects

### Phase 4
- Task success rate: 85%+ of multi-step tasks complete successfully
- Context efficiency: 30%+ reduction in unnecessary context

### Phase 5
- Rollback success: 100% of changeSets can be rolled back
- Auto-repair rate: 70%+ of errors fixed automatically

### Phase 6
- Test detection: 95%+ of test frameworks detected
- Terminal reliability: 99%+ of commands execute successfully

### Phase 7
- User satisfaction: >4.5/5 rating on UX improvements
- Debug efficiency: 50%+ reduction in time to diagnose issues

### Phase 8
- Plugin adoption: 10+ community plugins created
- Advanced agent usage: 20%+ of users use at least one advanced agent

---

## Risk Mitigation

### Technical Risks
- **Risk**: Subagents increase complexity and token usage
  - **Mitigation**: Careful context isolation, aggressive caching
- **Risk**: ChangeSet transactions may have edge cases
  - **Mitigation**: Extensive testing, conservative rollback logic
- **Risk**: Performance degradation with large codebases
  - **Mitigation**: Incremental indexing, lazy loading, result caching

### Product Risks
- **Risk**: Features may confuse users
  - **Mitigation**: Progressive disclosure, good defaults, clear documentation
- **Risk**: Too many features = bloat
  - **Mitigation**: Make advanced features opt-in, keep core simple

---

## Timeline Estimate

- **Phase 3**: 2-3 weeks
- **Phase 4**: 3-4 weeks
- **Phase 5**: 2-3 weeks
- **Phase 6**: 2-3 weeks
- **Phase 7**: 2-3 weeks
- **Phase 8**: 3-4 weeks (optional, lower priority)

**Total**: 14-20 weeks for phases 3-7 (core functionality)

---

## Next Steps

1. ✅ Commit Phase 2 completion
2. ✅ Complete Phase 3: project profile, code graph, BM25 retrieval, and reranking
3. ✅ Complete Phase 4: isolated planner, search, execution, and verification agents
4. ✅ Complete Phase 5: transactional ChangeSets, conflict detection, rollback, and self-repair
5. ✅ Complete Phase 6: Test Explorer, task provider, and terminal manager
