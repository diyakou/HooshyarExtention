import { Message } from "./types";

const APPROX_CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function messageCharLength(msg: Message): number {
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

export function historyCharLength(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + messageCharLength(message), 0);
}

export interface ContextCompactionPlan {
  olderMessages: Message[];
  recentMessages: Message[];
  originalChars: number;
  compactedChars: number;
}

/**
 * Splits history on atomic tool boundaries. Recent context is kept verbatim while
 * older turns are handed to the model for summarization.
 */
export function planContextCompaction(
  messages: Message[],
  keepRecentChars: number
): ContextCompactionPlan | undefined {
  const chunks = groupIntoAtomicChunks(messages);
  if (chunks.length < 4) return undefined;

  const recentChunks: Message[][] = [];
  let recentChars = 0;
  let splitIndex = chunks.length;

  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunkChars = chunks[i].reduce((sum, message) => sum + messageCharLength(message), 0);
    if (recentChunks.length >= 2 && recentChars + chunkChars > keepRecentChars) break;
    recentChunks.unshift(chunks[i]);
    recentChars += chunkChars;
    splitIndex = i;
  }

  if (splitIndex < 2) return undefined;

  const olderMessages = chunks.slice(0, splitIndex).flat();
  const recentMessages = recentChunks.flat();
  if (olderMessages.length < 2 || recentMessages.length < 1) return undefined;

  return {
    olderMessages,
    recentMessages,
    originalChars: historyCharLength(messages),
    compactedChars: historyCharLength(olderMessages)
  };
}

export function historyToCompactionText(messages: Message[]): string {
  return messages.map((message, index) => {
    const role = message.role.toUpperCase();
    if (typeof message.content === "string") {
      return `[${index + 1}] ${role}\n${message.content}`;
    }

    const blocks = message.content.map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return `[attached image: ${block.source.media_type}]`;
      if (block.type === "tool_use") {
        return `[tool call: ${block.name}]\n${JSON.stringify(block.input)}`;
      }
      if (block.type === "tool_result") {
        const status = block.is_error ? "error" : "result";
        return `[tool ${status}: ${block.tool_use_id}]\n${block.content}`;
      }
      return "";
    });
    return `[${index + 1}] ${role}\n${blocks.join("\n")}`;
  }).join("\n\n");
}

export function isToolResultUserMessage(msg: Message): boolean {
  return (
    msg.role === "user" &&
    Array.isArray(msg.content) &&
    msg.content.some((b) => b.type === "tool_result")
  );
}

export function hasToolUse(msg: Message): boolean {
  return (
    msg.role === "assistant" &&
    Array.isArray(msg.content) &&
    msg.content.some((b) => b.type === "tool_use")
  );
}

/**
 * Ensures strict alternation between user and assistant messages,
 * merges consecutive messages with the same role, and ensures every tool_use
 * has a matching tool_result.
 */
export function sanitizeMessageSequence(messages: Message[]): Message[] {
  if (messages.length === 0) return [];

  const sanitized: Message[] = [];

  // 1. Ensure conversation starts with a valid user message
  let startIndex = 0;
  while (startIndex < messages.length) {
    const m = messages[startIndex];
    if (m.role === "user") {
      // Must not be an orphaned tool_result at the very start
      if (isToolResultUserMessage(m)) {
        startIndex++;
        continue;
      }
      break;
    }
    startIndex++;
  }

  if (startIndex >= messages.length) {
    // If no valid user message found, synthesize one from the last message or default
    const last = messages[messages.length - 1];
    return [
      {
        role: "user",
        content: typeof last?.content === "string" ? last.content : "Please continue."
      }
    ];
  }

  for (let i = startIndex; i < messages.length; i++) {
    const curr = messages[i];
    if (sanitized.length === 0) {
      sanitized.push(curr);
      continue;
    }

    const prev = sanitized[sanitized.length - 1];

    if (prev.role === curr.role) {
      // Merge consecutive messages of the same role (strictly prohibited by Anthropic)
      if (typeof prev.content === "string" && typeof curr.content === "string") {
        prev.content = `${prev.content}\n\n${curr.content}`;
      } else {
        const prevBlocks = typeof prev.content === "string" ? [{ type: "text" as const, text: prev.content }] : prev.content;
        const currBlocks = typeof curr.content === "string" ? [{ type: "text" as const, text: curr.content }] : curr.content;
        prev.content = [...prevBlocks, ...currBlocks];
      }
    } else {
      sanitized.push(curr);
    }
  }

  // 2. Validate tool_use <-> tool_result integrity
  // Every assistant message containing tool_use MUST be followed by a user message with tool_result
  for (let i = 0; i < sanitized.length; i++) {
    const msg = sanitized[i];
    if (hasToolUse(msg)) {
      const toolUseBlocks = (Array.isArray(msg.content) ? msg.content : []).filter(
        (b) => b.type === "tool_use"
      ) as Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;

      const nextMsg = sanitized[i + 1];
      if (!nextMsg || nextMsg.role !== "user" || !Array.isArray(nextMsg.content)) {
        // Synthesize matching tool_result blocks so API does not throw 400
        const syntheticResults = toolUseBlocks.map((b) => ({
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: "[Tool execution completed]"
        }));
        sanitized.splice(i + 1, 0, {
          role: "user",
          content: syntheticResults
        });
        i++; // skip newly inserted message
      } else {
        // Ensure every tool_use ID is accounted for in nextMsg
        const existingIds = new Set(
          nextMsg.content.filter((b) => b.type === "tool_result").map((b: any) => b.tool_use_id)
        );
        for (const tu of toolUseBlocks) {
          if (!existingIds.has(tu.id)) {
            nextMsg.content.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: "[Tool execution completed]"
            });
          }
        }
      }
    }
  }

  return sanitized;
}

/**
 * Group messages into atomic dialogue chunks:
 * - A standard user message
 * - A standard assistant message
 * - A tool cycle: [assistant (with tool_use), user (with tool_results)]
 */
export function groupIntoAtomicChunks(messages: Message[]): Message[][] {
  const chunks: Message[][] = [];
  let i = 0;

  while (i < messages.length) {
    const current = messages[i];
    if (hasToolUse(current) && i + 1 < messages.length && isToolResultUserMessage(messages[i + 1])) {
      chunks.push([current, messages[i + 1]]);
      i += 2;
    } else {
      chunks.push([current]);
      i += 1;
    }
  }

  return chunks;
}

export function compactToolResultText(content: string, maxLen = 350): string {
  if (content.length <= maxLen) return content;
  const head = content.slice(0, 180);
  const tail = content.slice(-120);
  const omitted = content.length - 300;
  return `${head}\n... [${omitted} characters omitted from earlier turn to optimize tokens. Call tool again if full content is needed.] ...\n${tail}`;
}

/**
 * Prunes large tool outputs in earlier dialogue chunks while keeping the most recent
 * tool output(s) intact. This prevents massive tokens accumulating in multi-turn sessions.
 */
export function compactHistoricalToolResults(
  messages: Message[],
  keepRecentFullCount = 1,
  maxPrunedChars = 350
): Message[] {
  if (messages.length === 0) return [];

  // Group into atomic chunks
  const chunks = groupIntoAtomicChunks(messages);

  // Find chunks that contain tool results
  const toolChunkIndices: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const hasToolResult = chunk.some((m) => isToolResultUserMessage(m));
    if (hasToolResult) {
      toolChunkIndices.push(i);
    }
  }

  // Determine which tool chunk indices to prune (all except the last keepRecentFullCount)
  const indicesToPrune = new Set<number>();
  if (toolChunkIndices.length > keepRecentFullCount) {
    const toPrune = toolChunkIndices.slice(0, toolChunkIndices.length - keepRecentFullCount);
    for (const idx of toPrune) {
      indicesToPrune.add(idx);
    }
  }

  if (indicesToPrune.size === 0) {
    return messages;
  }

  const result: Message[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!indicesToPrune.has(i)) {
      result.push(...chunk);
      continue;
    }

    // Clone and compact tool results in this chunk
    for (const msg of chunk) {
      if (isToolResultUserMessage(msg) && Array.isArray(msg.content)) {
        const compactedBlocks = msg.content.map((block) => {
          if (block.type === "tool_result" && typeof block.content === "string" && !block.is_error) {
            return {
              ...block,
              content: compactToolResultText(block.content, maxPrunedChars)
            };
          }
          return block;
        });
        result.push({ ...msg, content: compactedBlocks });
      } else {
        result.push(msg);
      }
    }
  }

  return result;
}

/**
 * Trim oldest turns so the payload stays under maxContextChars.
 * - Always preserves the initial user task prompt (messages[0]).
 * - Preserves atomic tool_use + tool_result pairs so they are never severed.
 * - Enforces strict Anthropic/OpenAI schema compliance.
 */
export function trimHistoryForContext(messages: Message[], maxContextChars: number): Message[] {
  if (messages.length <= 2) {
    return sanitizeMessageSequence(messages);
  }

  const total = messages.reduce((sum, m) => sum + messageCharLength(m), 0);
  if (total <= maxContextChars) {
    return sanitizeMessageSequence(messages);
  }

  // 1. Separate the root user prompt (messages[0]) to preserve the original task goal
  const hasRootUser = messages[0].role === "user" && !isToolResultUserMessage(messages[0]);
  const rootMsg = hasRootUser ? messages[0] : null;
  const rootChars = rootMsg ? messageCharLength(rootMsg) : 0;

  // 2. Group the rest of the messages into atomic chunks
  const restMessages = hasRootUser ? messages.slice(1) : messages;
  const chunks = groupIntoAtomicChunks(restMessages);

  // 3. Collect chunks from newest to oldest within character limit
  const keptChunks: Message[][] = [];
  let accumulatedChars = rootChars;

  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const chunkChars = chunk.reduce((sum, m) => sum + messageCharLength(m), 0);
    if (keptChunks.length > 0 && accumulatedChars + chunkChars > maxContextChars) {
      break;
    }
    keptChunks.unshift(chunk);
    accumulatedChars += chunkChars;
  }

  // Flatten kept chunks
  const keptMessages: Message[] = [];
  for (const chunk of keptChunks) {
    keptMessages.push(...chunk);
  }

  // 4. Assemble with root prompt & truncation notice
  const finalSequence: Message[] = [];

  if (rootMsg) {
    if (keptChunks.length < chunks.length) {
      // Some turns were trimmed
      const notice = "[Earlier conversation turns omitted to fit model context window.]\n\n";
      const updatedRoot: Message =
        typeof rootMsg.content === "string"
          ? { role: "user", content: notice + rootMsg.content }
          : {
              role: "user",
              content: [{ type: "text", text: notice }, ...(rootMsg.content as any)]
            };
      finalSequence.push(updatedRoot);
    } else {
      finalSequence.push(rootMsg);
    }
  }

  finalSequence.push(...keptMessages);

  return sanitizeMessageSequence(finalSequence);
}
