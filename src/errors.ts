export type HooshyarErrorCode =
  | "PROVIDER_TIMEOUT"
  | "TOOL_NOT_FOUND"
  | "TOOL_DISABLED"
  | "TOOL_INPUT_INVALID"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_PERMISSION_DENIED"
  | "WORKSPACE_UNTRUSTED"
  | "PATCH_CONFLICT"
  | "INDEX_UNAVAILABLE"
  | "COMMAND_TIMEOUT"
  | "MCP_DISCONNECTED";

export class HooshyarError extends Error {
  constructor(
    public readonly code: HooshyarErrorCode,
    message: string,
    public readonly recoverable: boolean,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "HooshyarError";
  }

  static from(error: unknown, fallbackCode: HooshyarErrorCode = "TOOL_EXECUTION_FAILED"): HooshyarError {
    if (error instanceof HooshyarError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new HooshyarError(fallbackCode, message, true, error);
  }
}
