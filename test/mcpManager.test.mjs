import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpManager, resolveVariables, makeMcpToolName, readMcpServers, parseMcpServersWithValidation } from "../out/mcpManager.js";
import { buildToolDefinitions, executeTool, isMutatingTool } from "../out/tools.js";

describe("MCP Manager tests", () => {
  it("resolves variables in strings correctly", () => {
    const ws = "C:\\projects\\my-app";
    const res1 = resolveVariables("${workspaceFolder}/src", ws);
    assert.equal(res1, "C:\\projects\\my-app/src");

    const res2 = resolveVariables("${workspaceRoot}/dist", ws);
    assert.equal(res2, "C:\\projects\\my-app/dist");

    process.env.TEST_MCP_VAR = "secret_value";
    const res3 = resolveVariables("Bearer ${env:TEST_MCP_VAR}", ws);
    assert.equal(res3, "Bearer secret_value");
  });

  it("generates compliant tool names under 64 characters", () => {
    const name1 = makeMcpToolName("filesystem", "read_file");
    assert.equal(name1, "mcp_filesystem_read_file");
    assert.ok(name1.length <= 64);
    assert.match(name1, /^[a-zA-Z0-9_-]+$/);

    const longToolName = "very_long_tool_name_that_exceeds_sixty_four_characters_when_prefixed_by_server_name_completely";
    const name2 = makeMcpToolName("my_custom_server", longToolName);
    assert.ok(name2.length <= 64, `Length ${name2.length} is greater than 64`);
    assert.match(name2, /^[a-zA-Z0-9_-]+$/);
  });

  it("parses valid and invalid MCP JSON configs safely", () => {
    const json1 = JSON.stringify({
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
      }
    });
    const parsed1 = readMcpServers(json1);
    assert.ok(parsed1.filesystem);
    assert.equal(parsed1.filesystem.command, "npx");
    assert.deepEqual(parsed1.filesystem.args, ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]);

    const json2 = JSON.stringify({
      mcpServers: {
        sqlite: { command: "uvx", args: ["mcp-server-sqlite"] }
      }
    });
    const parsed2 = readMcpServers(json2);
    assert.ok(parsed2.sqlite);
    assert.equal(parsed2.sqlite.command, "uvx");

    const json3 = JSON.stringify({
      inputs: [],
      servers: {
        figma: { url: "https://mcp.figma.com/mcp", type: "http" }
      }
    });
    const parsed3 = readMcpServers(json3);
    assert.ok(parsed3.figma);
    assert.equal(parsed3.figma.url, "https://mcp.figma.com/mcp");

    assert.deepEqual(readMcpServers(""), {});
    assert.deepEqual(readMcpServers("{ invalid json"), {});
    assert.deepEqual(readMcpServers("[]"), {});

    // Direct object input (as VS Code settings might provide)
    const directObj = {
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "figma-developer-mcp", "--stdio"],
          env: { FIGMA_API_KEY: "figd_test" }
        }
      }
    };
    const parsedObj = readMcpServers(directObj);
    assert.ok(parsedObj.figma);
    assert.equal(parsedObj.figma.command, "npx");
    assert.equal(parsedObj.figma.env?.FIGMA_API_KEY, "figd_test");

    // JSON with comments and trailing commas (JSONC)
    const jsonWithComments = `
    {
      // Configuration for tools
      "mcpServers": {
        "figma": {
          "command": "npx",
          "args": ["-y", "figma-developer-mcp", "--stdio",],
        },
      }
    }
    `;
    const parsedJsonc = readMcpServers(jsonWithComments);
    assert.ok(parsedJsonc.figma);
    assert.equal(parsedJsonc.figma.command, "npx");

    // parseMcpServersWithValidation returns helpful error on bad JSON
    const resBad = parseMcpServersWithValidation("{ this is not json }");
    assert.ok(resBad.error);
    assert.match(resBad.error, /Invalid JSON/);

    const resUser = parseMcpServersWithValidation(JSON.stringify({
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "figma-developer-mcp", "--stdio"],
          env: { FIGMA_API_KEY: "test-figma-api-key" }
        }
      }
    }));
    assert.equal(resUser.error, undefined);
    assert.ok(resUser.servers.figma);
    assert.equal(resUser.servers.figma.command, "npx");
    assert.equal(resUser.servers.figma.env?.FIGMA_API_KEY, "test-figma-api-key");
  });

  it("integrates mcpTools into buildToolDefinitions", () => {
    const mcpTool = {
      name: "mcp_filesystem_read_file",
      description: "Read file from MCP server",
      input_schema: { type: "object", properties: { path: { type: "string" } } }
    };
    const tools = buildToolDefinitions({ enableShellTool: false, mcpTools: [mcpTool] });
    assert.ok(tools.some((t) => t.name === "mcp_filesystem_read_file"));
  });

  it("identifies mutating MCP tools correctly", () => {
    assert.equal(isMutatingTool("mcp_server_write_file"), true);
    assert.equal(isMutatingTool("mcp_server_delete_item"), true);
    assert.equal(isMutatingTool("mcp_server_execute_sql"), true);
    assert.equal(isMutatingTool("mcp_server_read_data"), false);
    assert.equal(isMutatingTool("mcp_server_query"), false);
  });

  it("tests an MCP server through its existing live connection", async () => {
    const manager = new McpManager();
    manager.serverStatuses.set("figma", {
      name: "figma",
      status: "connected",
      toolCount: 1,
      transport: "stdio"
    });
    manager.tools.set("figma", [
      { name: "mcp_figma_get_file", description: "Get Figma file", input_schema: { type: "object" } }
    ]);

    let cleanupCalled = false;
    manager.cleanupServer = () => {
      cleanupCalled = true;
    };
    manager.listTools = async () => manager.tools.get("figma");

    const result = await manager.testServer("figma", { command: "npx", args: ["figma-mcp"] });

    assert.equal(cleanupCalled, false);
    assert.equal(result.ok, true);
    assert.deepEqual(result.tools, ["mcp_figma_get_file"]);
  });
});
