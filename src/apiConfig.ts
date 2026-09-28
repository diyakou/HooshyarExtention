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

export function normalizeModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const apiRoot = trimmed.replace(/\/(?:chat\/completions?|messages?)$/i, "");
  if (/\/v1$/i.test(apiRoot)) return `${apiRoot}/models`;
  return `${apiRoot}/v1/models`;
}

export function normalizeUsageUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/v1\/(?:messages?\/)?usage$/i.test(trimmed) || /\/v1\/token\/usage$/i.test(trimmed)) return trimmed;
  const apiRoot = trimmed.replace(/\/(?:chat\/completions?|messages?)$/i, "");
  if (/\/v1$/i.test(apiRoot)) return `${apiRoot}/usage`;
  return `${apiRoot.replace(/\/v1$/i, "")}/v1/usage`;
}

export interface ApiUsageResponse {
  authenticated: boolean;
  key_masked?: string; key_name?: string; plan?: string; managed?: boolean; status?: string; billing_mode?: string;
  daily_limit?: number; used_today?: number; remaining_today?: number | null; usage_percent?: number; reset_at?: string | null;
  context_limit?: number;
  context?: { limit?: number; last_request_used?: number; last_request_remaining?: number; last_request_percent?: number } | null;
  started_at?: string | null; expires_at?: string | null; user_token_balance?: number | null;
  lifetime?: { total_requests?: number; total_billable_tokens?: number; total_input_tokens?: number; total_output_tokens?: number } | null;
  last_request?: { request_id?: string; model?: string; input_tokens?: number; output_tokens?: number; customer_billable_tokens?: number; created_at?: string } | null;
  billing?: Record<string, unknown> | null;
  limits?: { rpm?: number; concurrency?: number; max_context_tokens?: number; max_output_tokens?: number } | null;
}

export async function fetchApiUsage(config: ApiClientConfig, signal?: AbortSignal): Promise<ApiUsageResponse> {
  const response = await fetch(normalizeUsageUrl(config.baseUrl), { method: "GET", headers: buildRequestHeaders(config), signal });
  if (!response.ok) {
    const raw = (await response.text()).slice(0, 300);
    let detail = raw;
    try {
      const payload: any = JSON.parse(raw);
      detail = typeof payload?.detail === "string" ? payload.detail : raw;
    } catch { /* preserve the text response */ }
    const friendly = response.status === 401 ? "API key is invalid or missing." : `Usage request failed (${response.status}).`;
    throw new Error(`${friendly}${detail ? ` ${detail}` : ""}`);
  }
  const payload = await response.json() as ApiUsageResponse;
  if (!payload || typeof payload !== "object") throw new Error("Usage endpoint returned an invalid response.");
  return payload;
}

export async function fetchAvailableModels(config: ApiClientConfig, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(normalizeModelsUrl(config.baseUrl), {
    method: "GET",
    headers: buildRequestHeaders(config),
    signal
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Models request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const payload: any = await response.json();
  const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const ids: string[] = entries
    .map((item: any): unknown => typeof item === "string" ? item : item?.id || item?.name)
    .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id: string) => id.trim());
  return [...new Set<string>(ids)].sort((a: string, b: string) => a.localeCompare(b));
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
