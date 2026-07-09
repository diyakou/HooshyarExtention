import { Message } from "./types";

const APPROX_CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

function messageCharLength(msg: Message): number {
  if (typeof msg.content === "string") return msg.content.length;
  return msg.content
    .map((b) => {
      if (b.type === "text") return b.text.length;
      if (b.type === "image") return b.source.data.length + 200;
      if (b.type === "tool_result") return b.content.length + 40;
      if (b.type === "tool_use") return JSON.stringify(b.input).length + 40;
      return 0;
    })
    .reduce((a, b) => a + b, 0);
}

/**
 * Trim oldest non-system turns so the payload stays under maxContextChars.
 * Always keeps the latest user message.
 */
export function trimHistoryForContext(messages: Message[], maxContextChars: number): Message[] {
  if (messages.length <= 2) return messages;

  const total = messages.reduce((sum, m) => sum + messageCharLength(m), 0);
  if (total <= maxContextChars) return messages;

  const kept: Message[] = [];
  let chars = 0;
  const reversed = [...messages].reverse();

  for (const msg of reversed) {
    const len = messageCharLength(msg);
    if (kept.length > 0 && chars + len > maxContextChars) break;
    kept.unshift(msg);
    chars += len;
  }

  if (kept.length < messages.length) {
    kept.unshift({
      role: "user",
      content: "[Earlier conversation truncated to fit context window.]"
    });
  }
  return kept;
}
