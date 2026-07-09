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
}

export class ApiClient {
  constructor(private getConfig: () => ApiClientConfig) {}

  async send(
    request: Omit<MessagesRequest, "model" | "max_tokens" | "temperature" | "stream">,
    callbacks: StreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const cfg = this.getConfig();
    const url = normalizeApiUrl(cfg.baseUrl);
    const maxAttempts = Math.max(0, cfg.maxRetries) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return;

      const body: MessagesRequest = {
        ...request,
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: true
      };

      logDebug(`POST ${url} attempt ${attempt}/${maxAttempts}`);

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
        if (response.status >= 500 && attempt < maxAttempts) {
          logWarn(`${msg} — retrying...`);
          await sleep(1000 * attempt);
          continue;
        }
        callbacks.onError(msg);
        return;
      }

      if (!contentType.includes("text/event-stream") && contentType.includes("application/json")) {
        const json = (await response.json()) as MessagesResponse;
        handleNonStreamingResponse(json, callbacks);
        callbacks.onDone(json.stop_reason);
        return;
      }

      if (!response.body) {
        callbacks.onError("Provider returned an empty response body.");
        return;
      }

      const streamed = await consumeSseStream(response, callbacks, signal);
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
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

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
            if (block.type === "tool_use") {
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
