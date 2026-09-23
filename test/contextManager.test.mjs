import test from "node:test";
import assert from "node:assert/strict";
import {
  trimHistoryForContext,
  sanitizeMessageSequence,
  groupIntoAtomicChunks,
  isToolResultUserMessage,
  hasToolUse,
  compactHistoricalToolResults,
  compactToolResultText
} from "../out/contextManager.js";

test("Atomic Context Manager Tests", async (t) => {
  await t.test("groupIntoAtomicChunks pairs tool_use assistant message with tool_result user message", () => {
    const messages = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }]
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "file content" }]
      },
      { role: "assistant", content: "I read the file." }
    ];

    const chunks = groupIntoAtomicChunks(messages);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 1);
    assert.equal(chunks[0][0].content, "Hello");
    assert.equal(chunks[1].length, 2);
    assert.equal(chunks[1][0].role, "assistant");
    assert.equal(chunks[1][1].role, "user");
    assert.equal(chunks[2].length, 1);
  });

  await t.test("sanitizeMessageSequence merges consecutive user messages to prevent Anthropic 400", () => {
    const messages = [
      { role: "user", content: "Part 1" },
      { role: "user", content: "Part 2" },
      { role: "assistant", content: "Response" }
    ];

    const sanitized = sanitizeMessageSequence(messages);
    assert.equal(sanitized.length, 2);
    assert.equal(sanitized[0].role, "user");
    assert.match(sanitized[0].content, /Part 1\n\nPart 2/);
    assert.equal(sanitized[1].role, "assistant");
  });

  await t.test("sanitizeMessageSequence removes orphaned tool_result at the start", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "orphan_1", content: "orphaned" }]
      },
      { role: "user", content: "Real question" },
      { role: "assistant", content: "Answer" }
    ];

    const sanitized = sanitizeMessageSequence(messages);
    assert.equal(sanitized[0].role, "user");
    assert.equal(sanitized[0].content, "Real question");
  });

  await t.test("sanitizeMessageSequence synthesizes tool_result if assistant has tool_use without response", () => {
    const messages = [
      { role: "user", content: "Run this" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_x", name: "read_file", input: {} }]
      }
    ];

    const sanitized = sanitizeMessageSequence(messages);
    assert.equal(sanitized.length, 3);
    assert.equal(sanitized[2].role, "user");
    assert.equal(Array.isArray(sanitized[2].content), true);
    assert.equal(sanitized[2].content[0].type, "tool_result");
    assert.equal(sanitized[2].content[0].tool_use_id, "call_x");
  });

  await t.test("trimHistoryForContext preserves root user task while atomic trimming intermediate turns", () => {
    const initialPrompt = "Create a full stack application with authentication and database.";
    const longOutput = "x".repeat(500);

    const messages = [
      { role: "user", content: initialPrompt },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "1.ts" } }]
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: longOutput }]
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t2", name: "read_file", input: { path: "2.ts" } }]
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t2", content: longOutput }]
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t3", name: "read_file", input: { path: "3.ts" } }]
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t3", content: "recent content" }]
      }
    ];

    const trimmed = trimHistoryForContext(messages, 500);

    assert.match(trimmed[0].content, new RegExp(initialPrompt));
    assert.match(trimmed[0].content, /Earlier conversation turns omitted/);

    const hasT3Use = trimmed.some(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.id === "t3")
    );
    const hasT3Result = trimmed.some(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.tool_use_id === "t3")
    );
    assert.equal(hasT3Use, true, "t3 tool_use must be preserved");
    assert.equal(hasT3Result, true, "t3 tool_result must be preserved");

    assert.equal(trimmed[0].role, "user");
    for (let i = 0; i < trimmed.length - 1; i++) {
      assert.notEqual(trimmed[i].role, trimmed[i + 1].role, `Index ${i} and ${i + 1} must alternate`);
    }
  });

  await t.test("compactHistoricalToolResults compacts older tool outputs while keeping recent intact", () => {
    const hugeOutput1 = "A".repeat(5000);
    const hugeOutput2 = "B".repeat(5000);
    const recentOutput = "C".repeat(2000);

    const messages = [
      { role: "user", content: "Prompt 1" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: hugeOutput1 }] },
      { role: "assistant", content: "Answer 1" },
      { role: "user", content: "Prompt 2" },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: hugeOutput2 }] },
      { role: "assistant", content: "Answer 2" },
      { role: "user", content: "Prompt 3" },
      { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: recentOutput }] }
    ];

    const compacted = compactHistoricalToolResults(messages, 1, 350);

    // Recent tool result (t3) must remain untouched
    const t3Msg = compacted.find((m) => Array.isArray(m.content) && m.content.some((b) => b.tool_use_id === "t3"));
    assert.equal(t3Msg.content[0].content, recentOutput);

    // Older tool results (t1 and t2) must be compacted
    const t1Msg = compacted.find((m) => Array.isArray(m.content) && m.content.some((b) => b.tool_use_id === "t1"));
    assert.ok(t1Msg.content[0].content.length < 500);
    assert.match(t1Msg.content[0].content, /characters omitted from earlier turn/);

    const t2Msg = compacted.find((m) => Array.isArray(m.content) && m.content.some((b) => b.tool_use_id === "t2"));
    assert.ok(t2Msg.content[0].content.length < 500);
    assert.match(t2Msg.content[0].content, /characters omitted from earlier turn/);
  });
});

