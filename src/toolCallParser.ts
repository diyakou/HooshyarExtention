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
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object" && typeof obj.name === "string") {
      const input =
        obj.input && typeof obj.input === "object" && !Array.isArray(obj.input)
          ? (obj.input as Record<string, unknown>)
          : obj.parameters && typeof obj.parameters === "object" && !Array.isArray(obj.parameters)
          ? (obj.parameters as Record<string, unknown>)
          : {};
      return { name: obj.name, input };
    }
  } catch {
    const nameMatch = cleaned.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      const name = nameMatch[1];
      const input: Record<string, unknown> = {};
      const pathMatch = cleaned.match(/"path"\s*:\s*"([^"]*)"/);
      if (pathMatch) input.path = pathMatch[1];
      const patternMatch = cleaned.match(/"pattern"\s*:\s*"([^"]*)"/);
      if (patternMatch) input.pattern = patternMatch[1];
      const cmdMatch = cleaned.match(/"command"\s*:\s*"([\s\S]*?)"\s*}/);
      if (cmdMatch) input.command = cmdMatch[1];
      const contentMatch = cleaned.match(/"content"\s*:\s*"([\s\S]*)"\s*}?\s*}?\s*$/);
      if (contentMatch) {
        input.content = contentMatch[1]
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
      return { name, input };
    }
  }
  return null;
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
    if (key === "content") {
      out[key] = m[2].replace(/^\n/, "").replace(/\n$/, "");
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
  if (!userWantsFileWrite(userText)) return [];

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

export function userWantsFileWrite(userText: string): boolean {
  return (
    /(?:create|make|add|write|build|generate|edit|update|بساز|ایجاد|بنویس|ساخت|اضافه|ویرایش)/i.test(userText) ||
    /(?:readme|\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml)|file|فایل)/i.test(userText)
  );
}

function inferFilePath(userText: string, assistantText: string): string | null {
  const fromUser = userText.match(
    /(?:^|[\s"'`(])([\w./-]+\.(?:md|txt|ts|tsx|js|jsx|py|json|css|html|yml|yaml|toml|xml|csv|sh|bat|ps1))(?:[\s"'`)]|$)/i
  );
  if (fromUser) return normalizeRelPath(fromUser[1]);
  if (/readme/i.test(userText)) return "README.md";

  const fromAssistantFa = assistantText.match(/فایل\s+([\w./-]+\.\w+)/i);
  if (fromAssistantFa) return normalizeRelPath(fromAssistantFa[1]);
  if (/(?:README|readme)(?:\.md)?/i.test(assistantText)) return "README.md";

  const fromAssistantFile = assistantText.match(
    /(?:^|[\s"'`])([\w./-]+\.(?:md|txt|ts|tsx|js|jsx|py|json))(?:[\s"'`]|$)/m
  );
  if (fromAssistantFile) return normalizeRelPath(fromAssistantFile[1]);
  return null;
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function truncateToolOutput(output: string, max = 14_000): string {
  if (output.length <= max) return output;
  return output.slice(0, max) + `\n... (truncated — ${output.length - max} more characters)`;
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

  const fenced = body.match(/```(?:markdown|md|text)?\s*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim().length >= 20) return fenced[1].trim();

  const headingStart = body.search(/^#{1,6}\s+\S/m);
  if (headingStart >= 0) body = body.slice(headingStart);

  body = body.replace(
    /\n(?:---+\n)?(?:Would you like|Do you want|Shall I|Let me know|If you(?:'d| would)|آیا)[\s\S]*$/i,
    ""
  );

  body = body.trim();
  if (body.length < 20) return null;
  return body;
}

export function genId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
