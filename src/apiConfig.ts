import * as vscode from "vscode";

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
    model: cfg.get<string>("model", "claude-sonnet-4-6"),
    maxTokens: cfg.get<number>("maxTokens", 4096),
    temperature: cfg.get<number>("temperature", 1),
    extraHeaders,
    maxRetries: cfg.get<number>("maxRetries", 2),
    requestTimeoutMs: cfg.get<number>("requestTimeoutMs", 120_000),
    toolProtocol: cfg.get<ToolProtocol>("toolProtocol", "auto")
  };
}

export function buildRequestHeaders(cfg: ApiClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...cfg.extraHeaders
  };
  if (cfg.apiKey) {
    headers["x-api-key"] = cfg.apiKey;
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }
  return headers;
}

export function normalizeApiUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  return `${trimmed}/v1/messages`;
}

export function readInlineApiConfig(apiKey: string): ApiClientConfig {
  const base = readApiClientConfig(apiKey);
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  const inlineModel = cfg.get<string>("inlineModel", "").trim();
  return {
    ...base,
    model: inlineModel || base.model,
    temperature: cfg.get<number>("inlineTemperature", 0.2),
    maxTokens: cfg.get<number>("inlineMaxTokens", 512)
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
