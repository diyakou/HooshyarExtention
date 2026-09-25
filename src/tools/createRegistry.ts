import { logDebug } from "../logger";
import { ToolDefinition } from "../types";
import {
  buildToolDefinitions,
  executeTool,
  isMcpMutatingTool,
  isMutatingTool,
  isParallelSafeTool,
  ToolExecContext
} from "../tools";
import { ToolRegistry } from "./registry";
import { ToolCategory, ToolRisk } from "./types";

export interface CreateAgentToolRegistryOptions {
  enableShellTool: boolean;
  mcpTools?: ToolDefinition[];
  executionContext: ToolExecContext;
}

export function createAgentToolRegistry(options: CreateAgentToolRegistryOptions): ToolRegistry {
  const registry = new ToolRegistry({
    onTelemetry: (event) => {
      logDebug(
        `tool invocation=${event.invocationId} name=${event.toolName} success=${event.success} durationMs=${event.durationMs}`
      );
    }
  });

  const definitions = buildToolDefinitions({
    enableShellTool: options.enableShellTool,
    mcpTools: options.mcpTools
  });

  for (const definition of definitions) {
    const metadata = classifyTool(definition.name);
    registry.register({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.input_schema,
      ...metadata,
      execute: (input, context) =>
        executeTool(definition.name, input, { ...options.executionContext, signal: context.signal })
    });
  }
  return registry;
}

export function classifyTool(name: string): {
  category: ToolCategory;
  risk: ToolRisk;
  parallelSafe: boolean;
} {
  if (name.startsWith("mcp_")) {
    return {
      category: "mcp",
      risk: isMcpMutatingTool(name) ? "write" : "network",
      parallelSafe: false
    };
  }
  if (name === "run_command" || name === "run_in_terminal" || name === "verify_changes") {
    return { category: "terminal", risk: "execute", parallelSafe: false };
  }
  if (name === "search_replace" || name === "write_file" || name === "apply_changeset" || name === "create_plan" || name === "update_plan_step") {
    return { category: "filesystem", risk: "write", parallelSafe: false };
  }
  if (name === "rename_symbol") {
    return { category: "symbol", risk: "write", parallelSafe: false };
  }
  if (name === "get_workspace_symbols" || name === "get_diagnostics" || name.startsWith("find_") || name === "get_hover" || name === "get_document_symbols" || name === "get_call_hierarchy" || name === "get_related_files" || name === "get_symbol_dependencies" || name === "get_symbol_dependents") {
    return { category: "symbol", risk: "read", parallelSafe: isParallelSafeTool(name) };
  }
  if (name === "search_codebase" || name === "semantic_search" || name === "delegate_search" || name === "list_codebase") {
    return { category: "search", risk: "read", parallelSafe: isParallelSafeTool(name) };
  }
  if (name === "fetch_webpage") {
    return { category: "network", risk: "network", parallelSafe: true };
  }
  return {
    category: name === "task_complete" || name === "update_tasks" ? "agent" : "filesystem",
    risk: isMutatingTool(name) ? "write" : "read",
    parallelSafe: isParallelSafeTool(name)
  };
}
