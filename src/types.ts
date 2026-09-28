// Minimal typings for the /v1/messages Anthropic-compatible API described
// in your OpenAPI spec. Only what this extension actually uses.

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: ImageMediaType;
    data: string;
  };
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MessagesRequest {
  model: string;
  messages: Message[];
  max_tokens: number;
  system?: string;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  tools?: ToolDefinition[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
}

// Non-streaming response shape (Anthropic Messages format)
export interface MessagesResponse {
  id: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  model: string;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

// Streaming SSE event shapes (subset actually consumed by apiClient.ts)
export type StreamEvent =
  | { type: "message_start"; message: Partial<MessagesResponse> & { usage?: Usage } }
  | { type: "content_block_start"; index: number; content_block: ContentBlock }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string }; usage?: Usage }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { type: string; message: string } };

export interface TaskItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AttachedFile {
  path: string;
  content: string;
}

export interface AttachedImage {
  name: string;
  mediaType: ImageMediaType;
  base64: string;
}

export interface AttachmentPreview {
  name: string;
  dataUrl: string;
}

export type ChatMode = "ask" | "plan" | "agent" | "chat";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  history: Message[];
  taskList: TaskItem[];
  usage: Usage;
  mode?: ChatMode;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  updatedAt: number;
  mode?: ChatMode;
}

export type SkillReference = string | {
  path: string;
  name?: string;
  enabled?: boolean;
};

export interface SettingsData {
  apiFormat: "anthropic" | "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  toolProtocol: "auto" | "native" | "text";
  enableTools: boolean;
  enableShellTool: boolean;
  /** JSON object of stdio MCP servers; values contain command, args, env, and optional disabled. */
  mcpServers: string;
  figmaProxyEnabled: boolean;
  figmaProxyUrl: string;
  skills: SkillReference[];
  requireApprovalForWrites: boolean;
  autoApproveCommands?: boolean;
  autoApproveMode?: "off" | "safe" | "all";
  requireApprovalForCommands?: boolean;
  autoIncludeActiveFile: boolean;
  experimentalAutoCompact: boolean;
  debugLogging: boolean;
}

// Messages posted between the extension host and the webview UI
export type ExtensionToWebviewMessage =
  | { type: "assistantTextDelta"; text: string }
  | { type: "assistantMessageDone" }
  | { type: "toolCall"; id: string; name: string; input: Record<string, unknown> }
  | { type: "toolResult"; id: string; content: string; isError: boolean }
  | { type: "error"; message: string }
  | { type: "history"; messages: Message[] }
  | { type: "approvalRequest"; id: string; name: string; description: string; diffPreview?: string }
  | { type: "taskListUpdate"; tasks: TaskItem[] }
  | { type: "streaming"; active: boolean }
  | { type: "filesAttached"; files: string[] }
  | { type: "attachmentsUpdated"; files: string[]; images: AttachmentPreview[] }
  | { type: "usage"; inputTokens: number; outputTokens: number; contextTokens: number; maxContextTokens: number }
  | { type: "contextCompacted"; beforeTokens: number; afterTokens: number }
  | { type: "sessions"; sessions: ChatSessionMeta[]; currentId: string }
  | { type: "agentWorking"; active: boolean; statusText?: string }
  | { type: "promptProcessing"; text?: string }
  | { type: "mentionSuggestions"; items: { path: string; label: string }[] }
  | { type: "settingsLoaded"; settings: SettingsData }
  | { type: "settingsSaved"; success: boolean; message?: string }
  | { type: "activeTurnSync"; text: string; isWorking: boolean }
  | { type: "fileReverted"; path: string; message: string }
  | { type: "testConnectionResult"; ok: boolean; message: string }
  | { type: "apiUsageResult"; ok: boolean; usage?: import("./apiConfig").ApiUsageResponse; message?: string }
  | { type: "liveToolStart"; id: string; name: string }
  | { type: "liveToolStop"; id: string; name: string; input: Record<string, unknown> }
  | { type: "modeChanged"; mode: ChatMode }
  | { type: "testMcpServersResult"; statuses: { name: string; ok: boolean; message: string; tools: string[] }[] }
  | { type: "skillsAdded"; skills: SkillReference[]; message: string }
  | { type: "followUpPills"; pills: string[] }
  | { type: "sessionReviewUpdate"; files: string[] }
  | { type: "searchWorkspaceFilesResult"; query: string; files: string[] }
  | { type: "modelsLoaded"; models: string[]; selectedModel: string; error?: string }
  | { type: "figmaAuthStatus"; authenticated: boolean; expiresAt?: number; error?: string }
  | { type: "figmaAuthResult"; success: boolean; message: string; authenticated: boolean };

export type WebviewToExtensionMessage =
  | { type: "sendMessage"; text: string }
  | { type: "newChat" }
  | { type: "stop" }
  | { type: "attachFile" }
  | { type: "attachFolder" }
  | { type: "addImageData"; dataUrl: string; name?: string }
  | { type: "addFileContent"; name: string; content: string }
  | { type: "removeAttachment"; kind: "file" | "image"; index: number }
  | { type: "approvalResponse"; id: string; approved: boolean; alwaysApprove?: boolean }
  | { type: "openHistory" }
  | { type: "loadSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; title: string }
  | { type: "promptRenameSession"; id: string }
  | { type: "retryLastTurn" }
  | { type: "insertAtCursor"; text: string }
  | { type: "searchMentions"; query: string }
  | { type: "searchWorkspaceFiles"; query: string }
  | { type: "reviewAcceptAll" }
  | { type: "reviewDiscardAll" }
  | { type: "openReviewChanges" }
  | { type: "attachActiveFile" }
  | { type: "attachTxtMdFile" }
  | { type: "openExternal"; url: string }
  | { type: "openDiff"; path: string }
  | { type: "openFile"; path: string; line?: number }
  | { type: "revertFile"; path: string }
  | { type: "addFilesByPath"; paths: string[] }
  | { type: "getSettings" }
  | { type: "saveSettings"; settings: Partial<SettingsData> }
  | { type: "testConnection"; tempSettings?: Partial<SettingsData> }
  | { type: "requestApiUsage"; tempSettings?: Pick<SettingsData, "baseUrl" | "apiKey" | "apiFormat"> }
  | { type: "testMcpServers"; rawMcpServers?: string }
  | { type: "addSkills"; existingSkills: SkillReference[] }
  | { type: "openSettingsModal" }
  | { type: "copyLogs" }
  | { type: "showLogs" }
  | { type: "resync" }
  | { type: "ready" }
  | { type: "runInTerminal"; command: string }
  | { type: "setMode"; mode: ChatMode }
  | { type: "requestModels" }
  | { type: "getFigmaAuthStatus" }
  | { type: "loginFigma" }
  | { type: "logoutFigma" }
  | { type: "configureFigmaDesktop" };
