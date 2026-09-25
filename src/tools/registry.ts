import { randomUUID } from "crypto";
import { HooshyarError } from "../errors";
import { AgentTool, ToolExecutionResult, ToolTelemetryEvent, toToolDefinition } from "./types";

export interface ToolRegistryOptions {
  onTelemetry?: (event: ToolTelemetryEvent) => void;
  defaultTimeoutMs?: number;
  defaultMaxResultChars?: number;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxResultChars: number;

  constructor(private readonly options: ToolRegistryOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.defaultMaxResultChars = options.defaultMaxResultChars ?? 50_000;
  }

  register(tool: AgentTool, replace = false): void {
    if (!replace && this.tools.has(tool.name)) {
      throw new HooshyarError("TOOL_INPUT_INVALID", `Tool '${tool.name}' is already registered.`, false);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  setEnabled(name: string, enabled: boolean): void {
    const tool = this.tools.get(name);
    if (!tool) throw new HooshyarError("TOOL_NOT_FOUND", `Unknown tool: ${name}`, false);
    tool.enabled = enabled;
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()].filter((tool) => tool.enabled !== false);
  }

  getDefinitions() {
    return this.list().map(toToolDefinition);
  }

  async invoke(
    name: string,
    input: Record<string, unknown>,
    options: { invocationId?: string; signal?: AbortSignal } = {}
  ): Promise<ToolExecutionResult<string>> {
    const tool = this.tools.get(name);
    const invocationId = options.invocationId || randomUUID();
    if (!tool) throw new HooshyarError("TOOL_NOT_FOUND", `Unknown tool: ${name}`, false);
    if (tool.enabled === false) throw new HooshyarError("TOOL_DISABLED", `Tool '${name}' is disabled.`, true);
    validateInput(tool.inputSchema, input, name);

    const startedAt = Date.now();
    const controller = new AbortController();
    const relayAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", relayAbort, { once: true });
    const timeoutMs = tool.timeoutMs ?? this.defaultTimeoutMs;
    let rejectTimeout: ((error: Error) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      controller.abort(new Error(`Tool timed out after ${timeoutMs}ms.`));
      rejectTimeout?.(new HooshyarError("TOOL_TIMEOUT", `Tool '${name}' timed out after ${timeoutMs}ms.`, true));
    }, timeoutMs);

    try {
      const output = await Promise.race([
        tool.execute(input, { invocationId, signal: controller.signal }),
        timeout
      ]);
      if (controller.signal.aborted) {
        throw new HooshyarError("TOOL_TIMEOUT", `Tool '${name}' timed out or was cancelled.`, true);
      }
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const maxChars = tool.maxResultChars ?? this.defaultMaxResultChars;
      const truncated = text.length > maxChars;
      const result = truncated
        ? `${text.slice(0, maxChars)}\n\n[Tool result truncated at ${maxChars} characters]`
        : text;
      this.options.onTelemetry?.({
        invocationId,
        toolName: name,
        durationMs: Date.now() - startedAt,
        success: true,
        outputChars: text.length
      });
      return { invocationId, toolName: name, output: result, durationMs: Date.now() - startedAt, truncated };
    } catch (error) {
      const wrapped = controller.signal.aborted && !options.signal?.aborted
        ? new HooshyarError("TOOL_TIMEOUT", `Tool '${name}' timed out after ${timeoutMs}ms.`, true, error)
        : HooshyarError.from(error);
      this.options.onTelemetry?.({
        invocationId,
        toolName: name,
        durationMs: Date.now() - startedAt,
        success: false,
        errorCode: wrapped.code
      });
      throw wrapped;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", relayAbort);
    }
  }
}

function validateInput(schema: Record<string, unknown>, input: Record<string, unknown>, toolName: string): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HooshyarError("TOOL_INPUT_INVALID", `Tool '${toolName}' requires an object input.`, true);
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && (input[key] === undefined || input[key] === null)) {
      throw new HooshyarError("TOOL_INPUT_INVALID", `Tool '${toolName}' is missing required input '${key}'.`, true);
    }
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return;
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (input[key] === undefined || !propertySchema || typeof propertySchema !== "object" || Array.isArray(propertySchema)) continue;
    validateValue(input[key], propertySchema as Record<string, unknown>, `${toolName}.${key}`);
  }
}

function validateValue(value: unknown, schema: Record<string, unknown>, path: string): void {
  const expected = schema.type;
  const valid =
    expected === undefined ||
    (expected === "string" && typeof value === "string") ||
    (expected === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (expected === "integer" && typeof value === "number" && Number.isInteger(value)) ||
    (expected === "boolean" && typeof value === "boolean") ||
    (expected === "array" && Array.isArray(value)) ||
    (expected === "object" && Boolean(value) && typeof value === "object" && !Array.isArray(value));
  if (!valid) {
    throw new HooshyarError("TOOL_INPUT_INVALID", `Invalid input '${path}': expected ${String(expected)}.`, true);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new HooshyarError("TOOL_INPUT_INVALID", `Invalid input '${path}': value is not in the allowed enum.`, true);
  }
  if (expected === "array" && Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, index) => validateValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`));
  }
  if (expected === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    validateInput(schema, value as Record<string, unknown>, path);
  }
}
