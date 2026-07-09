import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { ApiClientConfig, sleep } from "./apiConfig";
import { Message } from "./types";

const INLINE_SYSTEM_PROMPT =
  "You are an inline code completion engine inside VS Code. " +
  "Return only the code that should be inserted at the cursor position. " +
  "Do not include markdown fences, explanations, or comments unless they are part of the code itself. " +
  "Keep completions short and directly relevant to surrounding code style.";

interface InlineProviderConfig {
  isEnabled: () => boolean;
  maxPromptChars: () => number;
  debounceMs: () => number;
  skipComments: () => boolean;
}

export class HooshyarInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly apiClient: ApiClient;
  private readonly cache = new Map<string, { value: string; at: number }>();
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private readonly getApiConfig: () => ApiClientConfig,
    private readonly cfg: InlineProviderConfig
  ) {
    this.apiClient = new ApiClient(() => this.getApiConfig());
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | undefined> {
    if (!this.cfg.isEnabled()) return;
    if (token.isCancellationRequested) return;
    if (this.cfg.skipComments() && isInsideCommentOrString(document, position)) return;

    const debounceMs = this.cfg.debounceMs();
    if (debounceMs > 0) {
      await sleep(debounceMs);
      if (token.isCancellationRequested) return;
    }

    const cacheKey = `${document.uri.toString()}:${position.line}:${position.character}:${document.version}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return new vscode.InlineCompletionList([
        new vscode.InlineCompletionItem(cached.value, new vscode.Range(position, position))
      ]);
    }

    const prompt = this.buildPrompt(document, position);
    if (!prompt) return;

    const signal = this.toAbortSignal(token);
    const completion = await this.requestCompletion(prompt, signal);
    if (!completion || token.isCancellationRequested) return;

    this.cache.set(cacheKey, { value: completion, at: Date.now() });
    if (this.cache.size > 40) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest) this.cache.delete(oldest);
    }

    const range = new vscode.Range(position, position);
    return new vscode.InlineCompletionList([new vscode.InlineCompletionItem(completion, range)]);
  }

  private buildPrompt(document: vscode.TextDocument, position: vscode.Position): string | null {
    const maxPromptChars = this.cfg.maxPromptChars();
    if (maxPromptChars < 500) return null;

    const beforeRange = new vscode.Range(new vscode.Position(0, 0), position);
    const afterRange = new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end);
    const before = document.getText(beforeRange);
    const after = document.getText(afterRange);

    const trimmedBefore =
      before.length > maxPromptChars ? before.slice(before.length - maxPromptChars) : before;
    const afterBudget = Math.max(0, maxPromptChars - trimmedBefore.length);
    const trimmedAfter = after.slice(0, Math.min(after.length, afterBudget));

    return [
      `File: ${document.fileName}`,
      `Language: ${document.languageId}`,
      "",
      "<PREFIX>",
      trimmedBefore,
      "</PREFIX>",
      "<SUFFIX>",
      trimmedAfter,
      "</SUFFIX>"
    ].join("\n");
  }

  private async requestCompletion(prompt: string, signal: AbortSignal): Promise<string | null> {
    const messages: Message[] = [{ role: "user", content: prompt }];
    let buffer = "";
    let hasError = false;

    await this.apiClient.send(
      {
        messages,
        system: INLINE_SYSTEM_PROMPT
      },
      {
        onTextDelta: (text) => {
          buffer += text;
        },
        onToolUseStart: () => {},
        onToolUseInputDelta: () => {},
        onToolUseStop: () => {},
        onDone: () => {},
        onError: () => {
          hasError = true;
        }
      },
      signal
    );

    if (hasError) return null;
    const cleaned = sanitizeCompletion(buffer);
    return cleaned.length > 0 ? cleaned : null;
  }

  private toAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
      controller.abort();
      return controller.signal;
    }
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
  }
}

function isInsideCommentOrString(document: vscode.TextDocument, position: vscode.Position): boolean {
  const line = document.lineAt(position.line).text;
  const prefix = line.slice(0, position.character).trimStart();
  if (prefix.startsWith("//") || prefix.startsWith("#") || prefix.startsWith("*")) return true;
  const singleQuotes = (prefix.match(/'/g) || []).length;
  const doubleQuotes = (prefix.match(/"/g) || []).length;
  return singleQuotes % 2 === 1 || doubleQuotes % 2 === 1;
}

function sanitizeCompletion(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    return fenced[1].trim();
  }
  return trimmed;
}
