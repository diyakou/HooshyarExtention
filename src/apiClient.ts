import { MessagesRequest, StreamEvent, ContentBlock, ToolUseBlock, MessagesResponse } from "./types";
import { ApiClientConfig, normalizeApiUrl, buildRequestHeaders, sleep } from "./apiConfig";
import { logDebug, logError, logWarn } from "./logger";

export interface StreamCallbacks {
  onTextDelta: (text: string) => void;
  onToolUseStart: (index: number, id: string, name: string) => void;
  onToolUseInputDelta: (index: number, partialJson: string) => void;
  onToolUseStop: (index: number) => void;
  onUsage?: (usage: { input_tokens?: number; output_tokens?: number }) => void;
  onNativeToolDetected?: () => void;
  onDone: (stopReason: string | null) => void;
  onError: (message: string) => void;
  onRawEvent?: (data: string) => void;
}

export function parseRetryAfterDelayMs(headerValue: string | null, fallbackMs: number): number {
  if (!headerValue) return fallbackMs;
  const seconds = parseFloat(headerValue);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.min(60_000, Math.round(seconds * 1000));
  }
  const parsedDate = Date.parse(headerValue);
  if (!isNaN(parsedDate)) {
    return Math.min(60_000, Math.max(1000, parsedDate - Date.now()));
  }
  return fallbackMs;
}

export class ApiClient {
  constructor(private getConfig: () => ApiClientConfig) {}

  async send(
    request: Omit<MessagesRequest, "model" | "max_tokens" | "temperature" | "stream">,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const cfg = this.getConfig();
    const isOpenAi = cfg.apiFormat === "openai";
    const url = normalizeApiUrl(cfg.baseUrl, cfg.apiFormat);
    const maxAttempts = Math.max(0, cfg.maxRetries) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return;

      let body: any;
      if (isOpenAi) {
        body = convertToOpenAiBody(request, cfg);
      } else {
        const enableCaching = cfg.enablePromptCaching !== false;
        let systemPayload: any = request.system;
        if (enableCaching && typeof request.system === "string" && request.system.trim().length > 1000) {
          systemPayload = [
            {
              type: "text",
              text: request.system,
              cache_control: { type: "ephemeral" }
            }
          ];
        }

        let toolsPayload = request.tools;
        if (enableCaching && Array.isArray(toolsPayload) && toolsPayload.length > 0) {
          const totalTools = toolsPayload.length;
          toolsPayload = toolsPayload.map((t, idx) => {
            if (idx === totalTools - 1) {
              return { ...t, cache_control: { type: "ephemeral" } };
            }
            return t;
          });
        }

        body = {
          ...request,
          system: systemPayload,
          tools: toolsPayload,
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          stream: true
        };
      }

      logDebug(`POST ${url} (${cfg.apiFormat}) attempt ${attempt}/${maxAttempts}`);

      let response: Response;
      try {
        const timeout = AbortSignal.timeout(cfg.requestTimeoutMs);
        const combined = signal.aborted ? signal : AbortSignal.any([signal, timeout]);
        response = await fetch(url, {
          method: "POST",
          headers: buildRequestHeaders(cfg),
          body: JSON.stringify(body),
          signal: combined
        });
      } catch (err: any) {
        const msg =
          err?.name === "TimeoutError"
            ? `Request timed out after ${cfg.requestTimeoutMs / 1000}s`
            : `Network error calling ${url}: ${err?.message ?? err}`;
        if (attempt < maxAttempts) {
          logWarn(`${msg} — retrying...`);
          await sleep(1000 * attempt);
          continue;
        }
        callbacks.onError(msg);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok) {
        const text = await safeText(response);
        const msg = `Provider returned HTTP ${response.status}: ${text}`;

        const isRateLimit = response.status === 429;
        const isServerError = response.status >= 500;

        if ((isRateLimit || isServerError) && attempt < maxAttempts) {
          const defaultBackoff = isRateLimit
            ? Math.min(30_000, 2000 * Math.pow(2, attempt - 1) + Math.random() * 500)
            : Math.min(15_000, 1000 * Math.pow(2, attempt - 1) + Math.random() * 300);

          const delayMs = isRateLimit
            ? parseRetryAfterDelayMs(response.headers.get("retry-after"), defaultBackoff)
            : defaultBackoff;

          logWarn(`${msg} — Retrying in ${Math.round(delayMs)}ms (attempt ${attempt}/${maxAttempts})...`);
          await sleep(delayMs);
          continue;
        }

        callbacks.onError(msg);
        return;
      }

      if (!contentType.includes("text/event-stream") && contentType.includes("application/json")) {
        const json = await response.json();
        if (isOpenAi) {
          handleOpenAiNonStreamingResponse(json, callbacks);
          callbacks.onDone((json as any).choices?.[0]?.finish_reason ?? null);
        } else {
          handleNonStreamingResponse(json as MessagesResponse, callbacks);
          callbacks.onDone((json as MessagesResponse).stop_reason);
        }
        return;
      }

      if (!response.body) {
        callbacks.onError("Provider returned an empty response body.");
        return;
      }

      const streamed = isOpenAi
        ? await consumeOpenAiSseStream(response, callbacks, signal)
        : await consumeSseStream(response, callbacks, signal);
      if (streamed.ok) {
        callbacks.onDone(streamed.stopReason);
        return;
      }

      if (streamed.retryable && attempt < maxAttempts) {
        logWarn(`${streamed.error} — retrying...`);
        await sleep(1000 * attempt);
        continue;
      }

      callbacks.onError(streamed.error ?? "Stream failed.");
      return;
    }
  }
}

async function consumeSseStream(
  response: Response,
  callbacks: StreamCallbacks,
  _signal: AbortSignal
): Promise<{ ok: boolean; stopReason: string | null; error?: string; retryable?: boolean }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let stopReason: string | null = null;
  let sawEvent = false;

  try {
    let reading = true;
    while (reading) {
      const { value, done } = await reader.read();
      if (done) {
        reading = false;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        if (frame.startsWith("event: ping")) continue;
        const lines = frame.split(/\r?\n/);
        for (const dataLine of lines) {
          if (!dataLine.startsWith("data:")) continue;
          
          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") {
            if (jsonStr === "[DONE]") callbacks.onRawEvent?.("[DONE]");
            continue;
          }

          callbacks.onRawEvent?.(jsonStr);

          let event: StreamEvent;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          sawEvent = true;

          switch (event.type) {
            case "message_start": {
              const usage = event.message?.usage;
              if (usage) callbacks.onUsage?.(usage);
              break;
            }
            case "content_block_start": {
              const block = event.content_block as ContentBlock;
              if (block && block.type === "tool_use") {
                callbacks.onNativeToolDetected?.();
                const tb = block as ToolUseBlock;
                callbacks.onToolUseStart(event.index, tb.id, tb.name);
              }
              break;
            }
            case "content_block_delta": {
              if (event.delta.type === "text_delta") {
                callbacks.onTextDelta(event.delta.text);
              } else if (event.delta.type === "input_json_delta") {
                callbacks.onToolUseInputDelta(event.index, event.delta.partial_json);
              }
              break;
            }
            case "content_block_stop": {
              callbacks.onToolUseStop(event.index);
              break;
            }
            case "message_delta": {
              if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
              if (event.usage) callbacks.onUsage?.(event.usage);
              break;
            }
            case "error": {
              logError(`SSE error: ${event.error.message}`);
              return { ok: false, stopReason: null, error: event.error.message, retryable: true };
            }
            default:
              break;
          }
        }
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return { ok: false, stopReason: null };
    return { ok: false, stopReason: null, error: `Stream error: ${err?.message ?? err}`, retryable: true };
  }

  if (!sawEvent) {
    return { ok: false, stopReason: null, error: "No SSE events received from provider.", retryable: true };
  }
  return { ok: true, stopReason };
}

function handleNonStreamingResponse(json: MessagesResponse, callbacks: StreamCallbacks): void {
  for (const block of json.content ?? []) {
    if (block.type === "text") {
      callbacks.onTextDelta(block.text);
    } else if (block.type === "tool_use") {
      callbacks.onNativeToolDetected?.();
      callbacks.onToolUseStart(0, block.id, block.name);
      callbacks.onToolUseInputDelta(0, JSON.stringify(block.input));
      callbacks.onToolUseStop(0);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<no body>";
  }
}

function convertToOpenAiBody(
  request: Omit<MessagesRequest, "model" | "max_tokens" | "temperature" | "stream">,
  cfg: ApiClientConfig
): Record<string, unknown> {
  const openAiMessages: Array<Record<string, unknown>> = [];

  if (request.system) {
    openAiMessages.push({ role: "system", content: request.system });
  }

  for (const m of request.messages) {
    if (typeof m.content === "string") {
      openAiMessages.push({ role: m.role, content: m.content });
      continue;
    }

    if (Array.isArray(m.content)) {
      if (m.role === "assistant") {
        const textParts = m.content
          .filter((b) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        const toolUseBlocks = m.content.filter((b) => b.type === "tool_use") as ToolUseBlock[];
        const assistantMsg: Record<string, unknown> = {
          role: "assistant",
          content: textParts || null
        };
        if (toolUseBlocks.length > 0) {
          assistantMsg.tool_calls = toolUseBlocks.map((tu) => ({
            id: tu.id,
            type: "function",
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input ?? {})
            }
          }));
        }
        openAiMessages.push(assistantMsg);
      } else {
        const toolResults = m.content.filter((b) => b.type === "tool_result");
        const nonToolResults = m.content.filter((b) => b.type !== "tool_result");

        if (toolResults.length > 0) {
          for (const tr of toolResults as any[]) {
            openAiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content)
            });
          }
        }

        if (nonToolResults.length > 0) {
          const contentParts: Array<Record<string, unknown>> = [];
          for (const b of nonToolResults as any[]) {
            if (b.type === "text") {
              contentParts.push({ type: "text", text: b.text });
            } else if (b.type === "image" && b.source) {
              const mime = b.source.media_type || "image/png";
              contentParts.push({
                type: "image_url",
                image_url: { url: `data:${mime};base64,${b.source.data}` }
              });
            }
          }
          if (contentParts.length === 1 && contentParts[0].type === "text") {
            openAiMessages.push({ role: "user", content: contentParts[0].text });
          } else if (contentParts.length > 0) {
            openAiMessages.push({ role: "user", content: contentParts });
          }
        }
      }
    }
  }

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages: openAiMessages,
    stream: true,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens
  };

  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
    if (request.tool_choice) {
      if (request.tool_choice.type === "auto") {
        payload.tool_choice = "auto";
      } else if (request.tool_choice.type === "any") {
        payload.tool_choice = "required";
      } else if (request.tool_choice.type === "tool" && request.tool_choice.name) {
        payload.tool_choice = { type: "function", function: { name: request.tool_choice.name } };
      }
    }
  }

  return payload;
}

async function consumeOpenAiSseStream(
  response: Response,
  callbacks: StreamCallbacks,
  _signal: AbortSignal
): Promise<{ ok: boolean; stopReason: string | null; error?: string; retryable?: boolean }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let stopReason: string | null = null;
  let sawEvent = false;
  const activeToolCalls = new Set<number>();
  const toolUseStarted = new Map<number, { id: string; name: string }>();

  try {
    let reading = true;
    while (reading) {
      const { value, done } = await reader.read();
      if (done) {
        reading = false;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split(/\r?\n/);
        for (const dataLine of lines) {
          if (!dataLine.startsWith("data:")) continue;

          const jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;
          if (jsonStr === "[DONE]") {
            callbacks.onRawEvent?.("[DONE]");
            sawEvent = true;
            break;
          }

          callbacks.onRawEvent?.(jsonStr);

          let event: any;
          try {
            event = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          sawEvent = true;

          if (event.usage) {
            callbacks.onUsage?.({
              input_tokens: event.usage.prompt_tokens,
              output_tokens: event.usage.completion_tokens
            });
          }

          const choice = event.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            stopReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            callbacks.onTextDelta(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              let entry = toolUseStarted.get(index);

              // In OpenAI, the first chunk of a tool_call usually has `id` and `function.name`.
              // Subsequent chunks have `function.arguments`.
              if (!entry) {
                entry = { id: tc.id || `call_${index}`, name: tc.function?.name || "" };
                toolUseStarted.set(index, entry);
                callbacks.onNativeToolDetected?.();
                callbacks.onToolUseStart(index, entry.id, entry.name);
                activeToolCalls.add(index);
              } else {
                // Only update ID or Name if they weren't present, but do NOT call onToolUseStart again.
                if (tc.id && !entry.id) entry.id = tc.id;
                if (tc.function?.name && !entry.name) {
                  entry.name = tc.function.name;
                }
              }
              if (tc.function?.arguments) {
                callbacks.onToolUseInputDelta(index, tc.function.arguments);
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return { ok: false, stopReason: null };
    return { ok: false, stopReason: null, error: `Stream error: ${err?.message ?? err}`, retryable: true };
  }

  for (const idx of activeToolCalls) {
    callbacks.onToolUseStop(idx);
  }

  if (!sawEvent) {
    return { ok: false, stopReason: null, error: "No SSE events received from provider.", retryable: true };
  }
  return { ok: true, stopReason };
}

function handleOpenAiNonStreamingResponse(json: any, callbacks: StreamCallbacks): void {
  const choice = json.choices?.[0];
  if (!choice) return;
  const msg = choice.message;
  if (!msg) return;

  if (json.usage) {
    callbacks.onUsage?.({
      input_tokens: json.usage.prompt_tokens,
      output_tokens: json.usage.completion_tokens
    });
  }

  if (msg.content) {
    callbacks.onTextDelta(msg.content);
  }

  if (Array.isArray(msg.tool_calls)) {
    for (let i = 0; i < msg.tool_calls.length; i++) {
      const tc = msg.tool_calls[i];
      callbacks.onNativeToolDetected?.();
      callbacks.onToolUseStart(i, tc.id, tc.function?.name || "");
      callbacks.onToolUseInputDelta(i, tc.function?.arguments || "{}");
      callbacks.onToolUseStop(i);
    }
  }
}
