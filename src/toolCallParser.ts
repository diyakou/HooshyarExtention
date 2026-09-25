import { ContentBlock, Message, ToolUseBlock } from "./types";

export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export function extractTextualToolCalls(
  blocks: ContentBlock[],
  knownToolNames: string[]
): { toolCalls: ToolUseBlock[]; cleanedText: string } {
  let text = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed: ParsedToolCall[] = [];

  // Unwrap any markdown code blocks enclosing tool calls or write_file tags
  text = text.replace(/```(?:xml|html|json|tool_call)?\s*(<(?:tool_call|write_file|search_replace)[\s\S]*?<\/(?:tool_call|write_file|search_replace)>)\s*```/g, "$1");

  text = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (_all, body: string) => {
    const call = parseJsonToolCall(body);
    if (call) parsed.push(call);
    return "";
  });

  text = text.replace(/<function>([\s\S]*?)<\/function>/g, (_all, inner: string) => {
    const nameMatch = inner.match(/<(?:tool_name|method_name|name)>\s*([^<]+?)\s*<\/(?:tool_name|method_name|name)>/);
    const paramsMatch = inner.match(/<(?:parameters|params|arguments|input)>\s*([\s\S]*?)\s*<\/(?:parameters|params|arguments|input)>/);
    const name = nameMatch ? nameMatch[1].trim() : "";
    if (name) {
      parsed.push({ name, input: parseParams(paramsMatch ? paramsMatch[1] : "") });
    }
    return "";
  });

  for (const toolName of knownToolNames) {
    const re = new RegExp(`<${escapeRegExp(toolName)}>([\\s\\S]*?)<\\/${escapeRegExp(toolName)}>`, "g");
    text = text.replace(re, (_all, inner: string) => {
      parsed.push({ name: toolName, input: parseParams(inner) });
      return "";
    });
  }

  const diffBlockRe = /<{7}\s*SEARCH[\r\n]+([\s\S]*?)={7}[\r\n]+([\s\S]*?)>{7}\s*REPLACE/g;
  let diffMatch: RegExpExecArray | null;
  while ((diffMatch = diffBlockRe.exec(text)) !== null) {
    const oldString = diffMatch[1].replace(/\r\n/g, "\n");
    const newString = diffMatch[2].replace(/\r\n/g, "\n");
    const textBefore = text.slice(0, diffMatch.index);
    const pathCandidate = inferFilePath(textBefore, textBefore) || inferFilePath(text, text);
    if (pathCandidate && oldString.trim()) {
      parsed.push({
        name: "search_replace",
        input: {
          path: pathCandidate,
          old_string: oldString,
          new_string: newString
        }
      });
    }
  }
  text = text.replace(diffBlockRe, "");

  const toolCalls: ToolUseBlock[] = parsed.map((c, i) => ({
    type: "tool_use",
    id: `text_tool_${i + 1}_${Date.now()}`,
    name: c.name,
    input: c.input
  }));

  return { toolCalls, cleanedText: text.trim() };
}

export function parseJsonToolCall(body: string): ParsedToolCall | null {
  const cleaned = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = safeParseJsonToolInput(cleaned);
  if (parsed && typeof parsed.name === "string") {
    const name = parsed.name;
    const input =
      parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)
        ? (parsed.input as Record<string, unknown>)
        : parsed.parameters && typeof parsed.parameters === "object" && !Array.isArray(parsed.parameters)
        ? (parsed.parameters as Record<string, unknown>)
        : parsed;
    return { name, input };
  }
  return null;
}

/**
 * Robust JSON parser for tool call inputs streamed or formatted by LLMs.
 * Handles unescaped control characters (newlines/tabs inside strings),
 * truncated streaming outputs, and falls back to regex property extraction.
 */
export function safeParseJsonToolInput(raw: string): Record<string, unknown> {
  const trimmed = (raw || "").trim();
  if (!trimmed) return {};

  // 1. Direct JSON.parse
  try {
    const res = JSON.parse(trimmed);
    if (res && typeof res === "object" && !Array.isArray(res)) {
      return res as Record<string, unknown>;
    }
  } catch {
    // Continue to resilient repairs
  }

  // 2. Escape raw unescaped control characters (literal newlines, tabs, etc.) inside string literals
  try {
    const sanitized = sanitizeJsonControlChars(trimmed);
    const res = JSON.parse(sanitized);
    if (res && typeof res === "object" && !Array.isArray(res)) {
      return res as Record<string, unknown>;
    }
  } catch {
    // Continue to repair truncation
  }

  // 3. Repair truncated JSON (e.g. streaming cutoff before closing quote or brace)
  try {
    const repaired = repairTruncatedJson(trimmed);
    const res = JSON.parse(repaired);
    if (res && typeof res === "object" && !Array.isArray(res)) {
      return res as Record<string, unknown>;
    }
  } catch {
    // Continue to regex fallback
  }

  // 4. Regex property extraction fallback
  return extractPropertiesWithRegex(trimmed);
}

function sanitizeJsonControlChars(str: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);

    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
      } else if (char === "\\") {
        result += char;
        escaped = true;
      } else if (char === '"') {
        result += char;
        inString = false;
      } else if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else if (code < 32) {
        result += "\\u" + code.toString(16).padStart(4, "0");
      } else {
        result += char;
      }
    } else {
      result += char;
      if (char === '"') {
        inString = true;
      }
    }
  }
  return result;
}

function repairTruncatedJson(str: string): string {
  const sanitized = sanitizeJsonControlChars(str);
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" && stack.length > 0 && stack[stack.length - 1] === "{") {
        stack.pop();
      } else if (char === "]" && stack.length > 0 && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  let repaired = sanitized;
  if (inString) {
    repaired += '"';
  }
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === "{" ? "}" : "]";
  }
  return repaired;
}

function extractPropertiesWithRegex(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const nameMatch = raw.match(/"(?:name|tool|tool_name)"\s*:\s*"([^"]+)"/i);
  if (nameMatch) out.name = nameMatch[1].trim();

  const pathMatch = raw.match(
    /"(?:path|file_path|filePath|file|filename|fileName|target_file|targetFile|target|dir|directory|folder)"\s*:\s*"([^"]+)"/i
  );
  if (pathMatch) out.path = pathMatch[1].trim();

  const patternMatch = raw.match(/"(?:pattern|query|search|needle|regex)"\s*:\s*"([^"]+)"/i);
  if (patternMatch) out.pattern = patternMatch[1];

  const cmdMatch = raw.match(/"(?:command|cmd|exec)"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*})/i);
  if (cmdMatch) out.command = unescapeJsonString(cmdMatch[1]);

  const oldMatch = raw.match(
    /"(?:old_string|oldString|old_text|oldText|search|find|original|target_string)"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*"(?:new_string|newString|new_text|path|file|replace))/i
  );
  if (oldMatch) out.old_string = unescapeJsonString(oldMatch[1]);

  const newMatch = raw.match(
    /"(?:new_string|newString|new_text|newText|replace|replacement|replacement_content)"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*"(?:old_string|path|file|replace_all)|\s*})/i
  );
  if (newMatch) out.new_string = unescapeJsonString(newMatch[1]);

  const replaceAllMatch = raw.match(/"(?:replace_all|replaceAll)"\s*:\s*(true|false)/i);
  if (replaceAllMatch) out.replace_all = replaceAllMatch[1].toLowerCase() === "true";

  // Match content across multiple formats (standard, or trailing to end of payload)
  const contentMatch =
    raw.match(/"(?:content|text|file_content|fileContent|code|body)"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*})/i) ||
    raw.match(/"(?:content|text|file_content|fileContent|code|body)"\s*:\s*"([\s\S]*)/i);
  if (contentMatch) {
    let c = contentMatch[1];
    // If matched trailing, strip closing quotation or braces if present
    c = c.replace(/"\s*}?\s*}?\s*$/, "");
    out.content = unescapeJsonString(c);
  }

  return out;
}

function unescapeJsonString(val: string): string {
  return val
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export function parseParams(raw: string): Record<string, unknown> {
  const trimmed = (raw || "").trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* tag parsing */
    }
  }

  const out: Record<string, unknown> = {};
  const tagRe = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(trimmed)) !== null) {
    const key = m[1];
    if (key === "content" || key === "old_string" || key === "new_string") {
      out[key] = m[2].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    } else {
      out[key] = coerceScalar(m[2].trim());
    }
  }
  return out;
}

function coerceScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractProposedFileWrites(blocks: ContentBlock[], userText: string): ToolUseBlock[] {
  // If the user asked for an edit/fix on an existing file, NEVER convert a code snippet into a destructive write_file!
  if (userWantsFileEdit(userText)) return [];
  if (!userWantsNewFile(userText)) return [];

  const text = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text.trim()) return [];

  const filePath = inferFilePath(userText, text);
  if (!filePath) return [];

  const content = extractFileContentFromAssistant(text, filePath);
  if (!content) return [];

  return [
    {
      type: "tool_use",
      id: `proposed_write_${Date.now()}`,
      name: "write_file",
      input: { path: filePath, content }
    }
  ];
}

export function userWantsFileEdit(userText: string): boolean {
  return (
    /(?:edit|update|patch|fix|modify|change|refactor|replace|add|insert|remove|delete|ویرایش|ادیت|تغییر|عوض|اصلاح|درست\s*کن|رفع\s*باگ|بهینه‌سازی|بهینه\s*سازی|جایگزین|ریپلیس|آپدیت|اضافه|حذف|پاک)/i.test(
      userText
    ) &&
    !/(?:rewrite\s+completely|from\s+scratch|کامل\s*بازنویسی|از\s*نو|از\s*اول|بازنویسی\s*کامل)/i.test(userText)
  );
}

export function userWantsNewFile(userText: string): boolean {
  const isInvestigatoryOnly =
    /^(?:بررسی|توضیح|چرا|چطور|چگونه|تحلیل|آیا|ببین|بگو|explain|check|review|why|how|what|is\s+there)\b/i.test(
      userText.trim()
    ) && !/(?:بساز|بنویس|ایجاد|create|write|make|generate)\b/i.test(userText);

  if (isInvestigatoryOnly) return false;

  const hasCreateVerb =
    /(?:create|make|write\s+a\s+new|generate|build|new\s+file|rewrite\s+completely|from\s+scratch|بساز|ایجاد|بنویس|ساخت|فایل\s*جدید|کامل\s*بازنویسی|از\s*نو|از\s*اول)/i.test(
      userText
    );

  const hasExplicitTarget =
    /(?:readme|\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|sql|sh|bat)|file\b|فایل)/i.test(
      userText
    );

  return hasCreateVerb && hasExplicitTarget && !userWantsFileEdit(userText);
}

export function userWantsFileWrite(userText: string): boolean {
  return userWantsNewFile(userText);
}

export function inferFilePath(userText: string, assistantText: string): string | null {
  const fromUser = userText.match(
    /(?:^|[\s"'`([])([\w./\\-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|xml|csv|sh|bat|ps1|sql))(?:[\s"'`)\]]|$)/i
  );
  if (fromUser) return normalizeRelPath(fromUser[1]);

  const fromFaName = userText.match(
    /(?:فایل|file|نام|به\s*نام)\s*[`"']?([\w./\\-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|xml|csv|sh|bat|ps1|sql))[`"']?/i
  );
  if (fromFaName) return normalizeRelPath(fromFaName[1]);

  const fromComment = assistantText.match(
    /(?:\/\/|#|\/\*|<!--)\s*(?:file(?:name|path)?|path):\s*([\w./\\-]+\.\w+)/i
  );
  if (fromComment) return normalizeRelPath(fromComment[1]);

  const fromSimpleComment = assistantText.match(
    /(?:\/\/|#|\/\*|<!--)\s*([\w./\\-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|xml|csv|sh|bat|ps1|sql))\s*(?:-->|\*\/|\r?\n|$)/i
  );
  if (fromSimpleComment) return normalizeRelPath(fromSimpleComment[1]);

  const fromBackticks = assistantText.match(
    /`([\w./\\-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|sql|sh))`(?:\s*(?:فایل|file|را|رو))?/i
  );
  if (fromBackticks) return normalizeRelPath(fromBackticks[1]);

  const fromAssistantFa = assistantText.match(/فایل\s*[`"']?([\w./\\-]+\.\w+)[`"']?/i);
  if (fromAssistantFa) return normalizeRelPath(fromAssistantFa[1]);

  if (/(?:README|readme)(?:\.md)?/i.test(userText) || /(?:README|readme)(?:\.md)?/i.test(assistantText)) {
    return "README.md";
  }

  const fromAssistantFile = assistantText.match(
    /(?:^|[\s"'`])([\w./\\-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|sql))(?:[\s"'`]|$)/m
  );
  if (fromAssistantFile) return normalizeRelPath(fromAssistantFile[1]);
  return null;
}

export function normalizeRelPath(p: string): string {
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (norm === "undefined" || norm === "null") return "";
  return norm;
}

export function truncateToolOutput(output: string, max = 45_000): string {
  if (output.length <= max) return output;
  return (
    output.slice(0, max) +
    `\n... (truncated — ${output.length - max} more characters. For files, use read_file with start_line and end_line to inspect remaining sections.)`
  );
}

export function flattenToolHistoryForApi(messages: Message[]): Message[] {
  const toolNames = new Map<string, string>();
  const out: Message[] = [];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push(msg);
      continue;
    }

    if (msg.role === "assistant") {
      const parts: string[] = [];
      for (const b of msg.content) {
        if (b.type === "text" && b.text.trim()) parts.push(b.text);
        if (b.type === "tool_use") {
          toolNames.set(b.id, b.name);
          parts.push(`<tool_call>${JSON.stringify({ name: b.name, input: b.input })}</tool_call>`);
        }
      }
      if (parts.length > 0) out.push({ role: "assistant", content: parts.join("\n\n") });
    } else {
      const textParts: string[] = [];
      const imageBlocks: import("./types").ImageBlock[] = [];
      for (const b of msg.content) {
        if (b.type === "tool_result") {
          const name = toolNames.get(b.tool_use_id) ?? "tool";
          textParts.push(`[Tool result: ${name}]\n${b.content}`);
        } else if (b.type === "text" && b.text.trim()) {
          textParts.push(b.text);
        } else if (b.type === "image") {
          imageBlocks.push(b);
        }
      }
      const rebuilt: import("./types").ContentBlock[] = [];
      if (textParts.length > 0) {
        rebuilt.push({ type: "text", text: textParts.join("\n\n") });
      }
      rebuilt.push(...imageBlocks);
      if (rebuilt.length === 0) continue;
      if (rebuilt.length === 1 && rebuilt[0].type === "text") {
        out.push({ role: "user", content: rebuilt[0].text });
      } else {
        out.push({ role: "user", content: rebuilt });
      }
    }
  }
  return out;
}

function extractFileContentFromAssistant(text: string, _filePath: string): string | null {
  let body = text;
  body = body.replace(/:::writing\{[^}]*\}\s*/g, "");

  const faHeader = body.match(/محتو(?:ی|ى)\s*پیشنهادی[^:\n]*:\s*\n?([\s\S]*)/i);
  if (faHeader) body = faHeader[1];

  const enHeader = body.match(/(?:suggested|proposed)\s+(?:content|file|readme)[^:\n]*:\s*\n?([\s\S]*)/i);
  if (enHeader) body = enHeader[1];

  // Match any fenced code block (python, js, ts, html, css, json, md, etc.)
  const fenced = body.match(/```[\w-]*\s*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim().length >= 5) {
    let code = fenced[1].trim();
    code = code.replace(/^(?:\/\/|#)\s*(?:file(?:name|path)?|path):[^\n]*\n+/i, "");
    return code;
  }

  return null;
}

export function genId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
