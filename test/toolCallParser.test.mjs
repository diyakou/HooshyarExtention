import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTextualToolCalls,
  flattenToolHistoryForApi,
  parseJsonToolCall,
  parseParams,
  userWantsFileWrite
} from "../out/toolCallParser.js";

describe("parseJsonToolCall", () => {
  it("parses valid JSON tool call", () => {
    const body = '{"name":"list_codebase","input":{"path":"."}}';
    const parsed = parseJsonToolCall(body);
    assert.equal(parsed?.name, "list_codebase");
    assert.deepEqual(parsed?.input, { path: "." });
  });
});

describe("parseParams", () => {
  it("parses tag-based write_file params", () => {
    const inner = "<path>README.md</path><content>\n# Hello\n</content>";
    const params = parseParams(inner);
    assert.equal(params.path, "README.md");
    assert.equal(params.content, "# Hello");
  });

  it("parses search_replace tags", () => {
    const inner =
      "<path>src/a.ts</path><old_string>foo</old_string><new_string>bar</new_string>";
    const params = parseParams(inner);
    assert.equal(params.path, "src/a.ts");
    assert.equal(params.old_string, "foo");
    assert.equal(params.new_string, "bar");
  });
});

describe("extractTextualToolCalls", () => {
  it("extracts tool_call JSON blocks", () => {
    const blocks = [
      {
        type: "text",
        text: 'Looking...\n<tool_call>{"name":"read_file","input":{"path":"cli.py"}}</tool_call>'
      }
    ];
    const { toolCalls, cleanedText } = extractTextualToolCalls(blocks, ["read_file"]);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, "read_file");
    assert.equal(toolCalls[0].input.path, "cli.py");
    assert.match(cleanedText, /Looking/);
    assert.doesNotMatch(cleanedText, /tool_call/);
  });

  it("extracts write_file tag format", () => {
    const blocks = [
      {
        type: "text",
        text: "<write_file><path>README.md</path><content>\n# Title\n</content></write_file>"
      }
    ];
    const { toolCalls } = extractTextualToolCalls(blocks, ["write_file"]);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].name, "write_file");
    assert.equal(toolCalls[0].input.path, "README.md");
    assert.match(String(toolCalls[0].input.content), /# Title/);
  });
});

describe("flattenToolHistoryForApi", () => {
  it("converts tool_use and tool_result to plain text", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Reading file." },
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "a.ts" }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "file contents"
          }
        ]
      }
    ];
    const flat = flattenToolHistoryForApi(messages);
    assert.equal(flat.length, 2);
    assert.match(flat[0].content, /tool_call/);
    assert.match(flat[1].content, /Tool result: read_file/);
    assert.match(flat[1].content, /file contents/);
  });
});

describe("userWantsFileWrite", () => {
  it("detects create readme requests", () => {
    assert.equal(userWantsFileWrite("please create readme.md"), true);
    assert.equal(userWantsFileWrite("what is 2+2?"), false);
  });
});
