import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTextualToolCalls,
  flattenToolHistoryForApi,
  parseJsonToolCall,
  parseParams,
  userWantsFileWrite,
  userWantsFileEdit,
  userWantsNewFile,
  extractProposedFileWrites,
  safeParseJsonToolInput,
  inferFilePath
} from "../out/toolCallParser.js";
import { applySearchReplace, findFuzzyLineMatch, normalizeToolInput } from "../out/tools.js";

describe("parseJsonToolCall", () => {
  it("parses valid JSON tool call", () => {
    const body = '{"name":"list_codebase","input":{"path":"."}}';
    const parsed = parseJsonToolCall(body);
    assert.equal(parsed?.name, "list_codebase");
    assert.deepEqual(parsed?.input, { path: "." });
  });

  it("parses search_replace JSON with regex fallback when malformed", () => {
    const body = '{"name":"search_replace","input":{"path":"src/test.ts","old_string":"foo","new_string":"bar","replace_all":true}}';
    const parsed = parseJsonToolCall(body);
    assert.equal(parsed?.name, "search_replace");
    assert.equal(parsed?.input.path, "src/test.ts");
    assert.equal(parsed?.input.old_string, "foo");
    assert.equal(parsed?.input.new_string, "bar");
    assert.equal(parsed?.input.replace_all, true);
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

  it("preserves exact indentation in old_string and new_string", () => {
    const inner =
      "<path>src/a.ts</path><old_string>\n    const a = 1;\n    const b = 2;\n</old_string><new_string>\n    const a = 10;\n    const b = 20;\n</new_string>";
    const params = parseParams(inner);
    assert.equal(params.old_string, "    const a = 1;\n    const b = 2;");
    assert.equal(params.new_string, "    const a = 10;\n    const b = 20;");
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

describe("userWantsFileWrite vs userWantsFileEdit", () => {
  it("detects create new file requests", () => {
    assert.equal(userWantsNewFile("please create readme.md"), true);
    assert.equal(userWantsNewFile("یک فایل پایتون به اسم test.py بساز"), true);
    assert.equal(userWantsFileWrite("please create readme.md"), true);
    assert.equal(userWantsFileWrite("what is 2+2?"), false);
  });

  it("detects edit requests and distinguishes them from new file creation", () => {
    assert.equal(userWantsFileEdit("فایل رو ویرایش کن و باگ رو رفع کن"), true);
    assert.equal(userWantsFileEdit("کد رو درست کن"), true);
    assert.equal(userWantsFileEdit("این متد رو تغییر بده"), true);
    assert.equal(userWantsFileEdit("fix bug in WalletService.php"), true);
    // An edit request should NOT be treated as a new file write
    assert.equal(userWantsNewFile("فایل رو ویرایش کن و باگ رو رفع کن"), false);
    assert.equal(userWantsFileWrite("فایل رو ویرایش کن و باگ رو رفع کن"), false);
  });

  it("does not trigger on investigatory questions", () => {
    assert.equal(userWantsNewFile("بررسی کن و نقطه ضعف هارو بگو"), false);
    assert.equal(userWantsNewFile("این فایل رو بررسی کن"), false);
    assert.equal(userWantsNewFile("پروژه چطور کار می‌کنه؟"), false);
    assert.equal(userWantsNewFile("explain how this file works"), false);
    assert.equal(userWantsFileEdit("این فایل چطور کار میکنه؟"), false);
  });
});

describe("extractProposedFileWrites", () => {
  it("extracts python code block with filename for new file creation", () => {
    const blocks = [
      {
        type: "text",
        text: "Here is the implementation:\n```python\ndef hello():\n    print('Hello')\n```"
      }
    ];
    const tools = extractProposedFileWrites(blocks, "یک فایل به اسم hello.py بساز");
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "write_file");
    assert.equal(tools[0].input.path, "hello.py");
    assert.match(String(tools[0].input.content), /def hello/);
  });

  it("does NOT emit write_file for edit requests to prevent wiping files", () => {
    const blocks = [
      {
        type: "text",
        text: "Added the function:\n```typescript\n// path: src/utils.ts\nexport function add(a: number, b: number) { return a + b; }\n```"
      }
    ];
    const tools = extractProposedFileWrites(blocks, "کد رو تغییر بده و باگ رو رفع کن");
    assert.equal(tools.length, 0); // Must be 0 so it doesn't overwrite src/utils.ts with a snippet!
  });
});

describe("applySearchReplace", () => {
  it("replaces exact match correctly", () => {
    const original = "function foo() {\n  return 1;\n}\n";
    const res = applySearchReplace(original, "  return 1;", "  return 2;");
    assert.equal(res.count, 1);
    assert.equal(res.updatedText, "function foo() {\n  return 2;\n}\n");
  });

  it("handles CRLF line endings on Windows correctly", () => {
    const original = "class Test {\r\n  public $x = 1;\r\n}\r\n";
    const res = applySearchReplace(original, "  public $x = 1;", "  public $x = 2;");
    assert.equal(res.count, 1);
    assert.equal(res.updatedText, "class Test {\r\n  public $x = 2;\r\n}\r\n");
  });

  it("performs fuzzy matching when trailing whitespace differs", () => {
    const original = "function test() {\n    const a = 1;   \n    return a;\n}";
    const res = applySearchReplace(original, "    const a = 1;\n    return a;", "    return 2;");
    assert.equal(res.count, 1);
    assert.equal(res.updatedText, "function test() {\n    return 2;\n}");
  });

  it("performs fuzzy matching when indentation differs", () => {
    const original = "class A {\n    function b() {\n        return true;\n    }\n}";
    const res = applySearchReplace(original, "  function b() {\n    return true;\n  }", "  function b() {\n    return false;\n  }");
    assert.equal(res.count, 1);
    assert.match(res.updatedText, /return false;/);
  });

  it("handles trimmed block matches with extra leading/trailing blank lines", () => {
    const original = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const res = applySearchReplace(original, "\nconst y = 2;\n", "const y = 20;");
    assert.equal(res.count, 1);
    assert.match(res.updatedText, /const y = 20;/);
  });
});

describe("normalizeToolInput", () => {
  it("normalizes path from file_path, filePath, file, or target_file", () => {
    assert.equal(normalizeToolInput("read_file", { file_path: "src/app.ts" }).path, "src/app.ts");
    assert.equal(normalizeToolInput("read_file", { filePath: "./src/app.ts" }).path, "src/app.ts");
    assert.equal(normalizeToolInput("read_file", { file: "src/app.ts" }).path, "src/app.ts");
    assert.equal(normalizeToolInput("read_file", { target_file: "src/app.ts" }).path, "src/app.ts");
  });

  it("defaults directory tools to dot if path is empty", () => {
    assert.equal(normalizeToolInput("list_codebase", {}).path, ".");
    assert.equal(normalizeToolInput("list_files", {}).path, ".");
  });

  it("normalizes search_replace parameter aliases", () => {
    const input = {
      file_path: "src/test.ts",
      search: "const a = 1;",
      replace: "const a = 2;",
      replaceAll: true
    };
    const norm = normalizeToolInput("search_replace", input);
    assert.equal(norm.path, "src/test.ts");
    assert.equal(norm.old_string, "const a = 1;");
    assert.equal(norm.new_string, "const a = 2;");
    assert.equal(norm.replace_all, true);
  });

  it("normalizes search_codebase query to pattern", () => {
    const norm = normalizeToolInput("search_codebase", { query: "export function" });
    assert.equal(norm.pattern, "export function");
  });

  it("unpacks nested parameters and arguments objects", () => {
    const nestedParams = {
      parameters: { path: "hello.py", content: "print('hello')" }
    };
    const norm1 = normalizeToolInput("write_file", nestedParams);
    assert.equal(norm1.path, "hello.py");
    assert.equal(norm1.content, "print('hello')");

    const nestedArgs = {
      arguments: { file_path: "src/index.js", body: "console.log(1);" }
    };
    const norm2 = normalizeToolInput("write_file", nestedArgs);
    assert.equal(norm2.path, "src/index.js");
    assert.equal(norm2.content, "console.log(1);");
  });

  it("unpacks stringified JSON arguments (OpenAI format)", () => {
    const stringified = {
      arguments: '{"path": "test.txt", "content": "hello world"}'
    };
    const norm = normalizeToolInput("write_file", stringified);
    assert.equal(norm.path, "test.txt");
    assert.equal(norm.content, "hello world");
  });

  it("guards against literal 'undefined' or 'null' path strings", () => {
    const norm1 = normalizeToolInput("write_file", { path: "undefined", content: "abc" });
    assert.equal(norm1.path, undefined);
    const norm2 = normalizeToolInput("write_file", { path: "null", content: "abc" });
    assert.equal(norm2.path, undefined);
  });

  it("accepts fileName and file_name and name for write_file", () => {
    const norm1 = normalizeToolInput("write_file", { fileName: "app.ts", content: "export {}" });
    assert.equal(norm1.path, "app.ts");
    const norm2 = normalizeToolInput("write_file", { file_name: "app.ts", content: "export {}" });
    assert.equal(norm2.path, "app.ts");
    const norm3 = normalizeToolInput("write_file", { name: "app.ts", content: "export {}" });
    assert.equal(norm3.path, "app.ts");
  });
});

describe("safeParseJsonToolInput", () => {
  it("parses valid JSON directly", () => {
    const res = safeParseJsonToolInput('{"path":"main.py","content":"def test(): pass"}');
    assert.equal(res.path, "main.py");
    assert.equal(res.content, "def test(): pass");
  });

  it("handles unescaped literal newlines in strings without throwing", () => {
    // Literal newline inside the string causes JSON.parse to throw 'Bad control character'
    const rawWithLiteralNewline = '{"path":"app.js","content":"function run() {\n  return 42;\n}"}';
    const res = safeParseJsonToolInput(rawWithLiteralNewline);
    assert.equal(res.path, "app.js");
    assert.equal(res.content, "function run() {\n  return 42;\n}");
  });

  it("handles literal tabs and control characters inside code content", () => {
    const rawWithTabs = '{"path":"main.go","content":"package main\n\tfunc main() {}\n"}';
    const res = safeParseJsonToolInput(rawWithTabs);
    assert.equal(res.path, "main.go");
    assert.match(String(res.content), /package main/);
  });

  it("repairs truncated JSON from LLM streaming cutoffs", () => {
    const truncated = '{"path":"style.css","content":"body {\n  color: red;';
    const res = safeParseJsonToolInput(truncated);
    assert.equal(res.path, "style.css");
    assert.match(String(res.content), /color: red;/);
  });

  it("extracts properties using regex fallback for badly malformed JSON", () => {
    const malformed = '{ name: "write_file", "path": "test.txt", "content": "sample content" ';
    const res = safeParseJsonToolInput(malformed);
    assert.equal(res.path, "test.txt");
    assert.equal(res.content, "sample content");
  });
});

describe("inferFilePath", () => {
  it("infers file path from Persian user message", () => {
    const path1 = inferFilePath("لطفاً فایل index.html را بساز", "");
    assert.equal(path1, "index.html");

    const path2 = inferFilePath("توی فایل script.js بنویس کدهای مربوط به منو رو", "");
    assert.equal(path2, "script.js");

    const path3 = inferFilePath("فایل جدیدی به نام server.ts ایجاد کن", "");
    assert.equal(path3, "server.ts");
  });

  it("infers file path from code comments in assistant text", () => {
    const path1 = inferFilePath("کد را بنویس", "// file: utils.ts\nexport function add() {}");
    assert.equal(path1, "utils.ts");

    const path2 = inferFilePath("کد را بنویس", "/* path: config.json */\n{\n}");
    assert.equal(path2, "config.json");

    const path3 = inferFilePath("کد را بنویس", "<!-- index.html -->\n<!DOCTYPE html>");
    assert.equal(path3, "index.html");
  });

  it("defaults to README.md if README is mentioned", () => {
    assert.equal(inferFilePath("یک فایل readme برای پروژه بساز", ""), "README.md");
  });
});

