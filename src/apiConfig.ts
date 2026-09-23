import * as vscode from "vscode";

export type ApiFormat = "anthropic" | "openai";
export type ToolProtocol = "auto" | "native" | "text";

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  extraHeaders: Record<string, string>;
  maxRetries: number;
  requestTimeoutMs: number;
  toolProtocol: ToolProtocol;
  apiFormat: ApiFormat;
  enablePromptCaching?: boolean;
}

export function readApiClientConfig(apiKey: string): ApiClientConfig {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  const extraRaw = cfg.get<string>("extraHeaders", "{}");
  let extraHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(extraRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      extraHeaders = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string") as [string, string][]
      );
    }
  } catch {
    /* ignore invalid JSON */
  }

  return {
    baseUrl: cfg.get<string>("baseUrl", "https://wqai.morvism.ir/v1"),
    apiKey,
    model: cfg.get<string>("model", "claude-sonnet-5"),
    maxTokens: cfg.get<number>("maxTokens", 4096),
    temperature: cfg.get<number>("temperature", 1),
    extraHeaders,
    maxRetries: cfg.get<number>("maxRetries", 2),
    requestTimeoutMs: cfg.get<number>("requestTimeoutMs", 120_000),
    toolProtocol: cfg.get<ToolProtocol>("toolProtocol", "auto"),
    apiFormat: cfg.get<ApiFormat>("apiFormat", "anthropic"),
    enablePromptCaching: cfg.get<boolean>("enablePromptCaching", true)
  };
}

export function buildRequestHeaders(cfg: ApiClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "claude-code/hooshyar",
    ...cfg.extraHeaders
  };
  if (cfg.apiFormat === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    if (cfg.apiKey) {
      headers["x-api-key"] = cfg.apiKey;
    }
  }
  if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }
  return headers;
}

export function normalizeApiUrl(baseUrl: string, format: ApiFormat = "anthropic"): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (format === "openai") {
    if (trimmed.endsWith("/chat/completions") || trimmed.endsWith("/chat/completion")) return trimmed;
    const base = trimmed.replace(/\/v1$/, "");
    return `${base}/v1/chat/completions`;
  }
  if (
    trimmed.endsWith("/v1/messages") ||
    trimmed.endsWith("/v1/message") ||
    trimmed.endsWith("/messages") ||
    trimmed.endsWith("/message")
  ) {
    return trimmed;
  }
  const base = trimmed.replace(/\/v1$/, "");
  return `${base}/v1/messages`;
}

export function readInlineApiConfig(apiKey: string): ApiClientConfig {
  const base = readApiClientConfig(apiKey);
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  const inlineModel = cfg.get<string>("inlineModel", "").trim();
  return {
    ...base,
    model: inlineModel || "claude-3-5-haiku",
    temperature: cfg.get<number>("inlineTemperature", 0.2),
    maxTokens: cfg.get<number>("inlineMaxTokens", 256)
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
