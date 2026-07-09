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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  history: Message[];
  taskList: TaskItem[];
  usage: Usage;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  updatedAt: number;
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
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "sessions"; sessions: ChatSessionMeta[]; currentId: string }
  | { type: "agentWorking"; active: boolean }
  | { type: "mentionSuggestions"; items: { path: string; label: string }[] };

export type WebviewToExtensionMessage =
  | { type: "sendMessage"; text: string }
  | { type: "newChat" }
  | { type: "stop" }
  | { type: "attachFile" }
  | { type: "removeAttachment"; kind: "file" | "image"; index: number }
  | { type: "approvalResponse"; id: string; approved: boolean }
  | { type: "openHistory" }
  | { type: "loadSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "renameSession"; id: string; title: string }
  | { type: "retryLastTurn" }
  | { type: "insertAtCursor"; text: string }
  | { type: "searchMentions"; query: string }
  | { type: "ready" };
