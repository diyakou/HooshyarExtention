import { ToolDefinition } from "../types";

export type ToolCategory =
  | "filesystem"
  | "search"
  | "symbol"
  | "terminal"
  | "test"
  | "debug"
  | "git"
  | "editor"
  | "mcp"
  | "agent"
  | "network";

export type ToolRisk = "read" | "write" | "execute" | "network";

export interface ToolExecutionContext {
  invocationId: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult<TOutput = unknown> {
  invocationId: string;
  toolName: string;
  output: TOutput;
  durationMs: number;
  truncated: boolean;
}

export interface ToolTelemetryEvent {
  invocationId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  outputChars?: number;
}

export interface AgentTool<TInput = Record<string, unknown>, TOutput = string> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: ToolCategory;
  risk: ToolRisk;
  enabled?: boolean;
  parallelSafe?: boolean;
  timeoutMs?: number;
  maxResultChars?: number;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  };
}
