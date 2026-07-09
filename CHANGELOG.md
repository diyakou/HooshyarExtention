# Changelog

All notable changes to Hooshyar are documented in this file.

## [0.3.0] - 2026-07-09

### Added (P1)
- In-webview chat history sidebar with delete/rename
- Message actions: Copy, Insert at cursor, Retry last turn
- @-mentions: `@file`, `@workspace`, `@selection` with autocomplete
- RTL layout detection for Persian input
- Inline diff preview in approval banner
- Project rules loader (`.cursorrules`, `.cursor/rules`, `.hooshyar/rules.md`)
- Git diff summary + symbol outline in context
- Ripgrep-backed `search_codebase` (with fallback)
- Workspace file index for mentions
- Inline completion: debounce, cache, separate model, skip comments/strings
- Architecture modules: `sessionManager`, `messageNormalizer`, `mentionResolver`, `rulesLoader`, `contextProviders`, `workspaceIndex`, `ripgrepSearch`

## [0.2.0] - 2026-07-09

### Added
- Chat session history persisted in VS Code global state (up to 50 sessions)
- Token usage display in the chat status bar
- Inline ghost-text completions (Copilot-style)
- `search_replace` tool for targeted edits
- Diff preview before approving file writes
- Undo last write command (`Hooshyar: Undo Last Write`)
- Test connection command (`Hooshyar: Test Connection`)
- Textual tool-call fallback parser (`<tool_call>`, tag-based `<write_file>`, etc.)
- Retry/timeout, non-streaming JSON fallback, and configurable auth headers
- Multi-root workspace support, gitignore/cursorignore respect, binary/size limits
- Output channel logging (`Hooshyar`)
- Unit tests for tool-call parsing

### Fixed
- Empty `list_codebase` results when `path` was `"."`
- Agent stalling after tool calls on providers that do not understand native tool blocks
- Model dumping file content in chat instead of calling `write_file`

## [0.1.0] - 2026-07-08

- Initial release: chat panel, agent loop, basic file tools, SSE streaming to Anthropic-compatible `/v1/messages` providers.
