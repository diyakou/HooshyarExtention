import { ChildProcessWithoutNullStreams, spawn, exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import * as vscode from "vscode";
import { ToolDefinition } from "./types";
import { logDebug, logError, logInfo, logWarn } from "./logger";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: boolean | string[];
}

export interface McpServerStatus {
  name: string;
  status: "connected" | "connecting" | "error" | "stopped" | "disabled";
  toolCount: number;
  error?: string;
  transport?: "stdio" | "sse";
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
}

/**
 * Forcibly terminates a child process and its entire process tree (prevents orphan processes).
 */
export function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child || child.killed || !child.pid) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32") {
      exec(`taskkill /pid ${pid} /T /F`, { windowsHide: true }, () => {
        try { child.kill(); } catch { /* ignore */ }
      });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }
  } catch {
    try { child.kill(); } catch { /* ignore */ }
  }
}

/**
 * Resolves configuration variables like ${workspaceFolder}, ${workspaceRoot}, ${env:VAR}
 */
export function resolveVariables(text: string, workspaceFolder?: string): string {
  if (!text) return text;
  let result = text;
  const root = workspaceFolder || (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "");
  if (root) {
    result = result.replace(/\$\{(?:workspaceFolder|workspaceRoot)\}/g, root);
  }
  result = result.replace(/\$\{env:([^}]+)\}/g, (_, varName) => process.env[varName] ?? "");
  result = result.replace(/\$\{pathSeparator\}/g, path.sep);
  return result;
}

/**
 * Generates an Anthropic/OpenAI compatible tool name (max 64 chars, valid chars: a-zA-Z0-9_-)
 */
export function makeMcpToolName(serverName: string, toolName: string): string {
  const cleanServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const candidate = `mcp_${cleanServer}_${cleanTool}`;
  if (candidate.length <= 64) {
    return candidate;
  }
  let hash = 0;
  for (let i = 0; i < candidate.length; i++) {
    hash = ((hash << 5) - hash) + candidate.charCodeAt(i);
    hash |= 0;
  }
  const hashStr = Math.abs(hash).toString(36);
  const prefix = candidate.slice(0, 64 - hashStr.length - 1);
  return `${prefix}_${hashStr}`;
}

/** Production-grade MCP client supporting stdio and remote HTTP/SSE servers. */
export class McpManager {
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private pending = new Map<string, PendingRequest>();
  private tools = new Map<string, ToolDefinition[]>();
  private initPromises = new Map<string, Promise<void>>();
  private serverStatuses = new Map<string, McpServerStatus>();
  private toolMapping = new Map<string, { serverName: string; originalToolName: string }>();
  private sequence = 0;
  private figmaTokenProvider?: () => Promise<string | null>;
  private figmaTokenRefresher?: () => Promise<string | null>;

  public setFigmaTokenProvider(
    provider: () => Promise<string | null>,
    refresher?: () => Promise<string | null>
  ): void {
    this.figmaTokenProvider = provider;
    this.figmaTokenRefresher = refresher;
  }

  public async listTools(servers: Record<string, McpServerConfig>): Promise<ToolDefinition[]> {
    const result: ToolDefinition[] = [];
    for (const [serverName, config] of Object.entries(servers)) {
      if (config.disabled) {
        this.serverStatuses.set(serverName, { name: serverName, status: "disabled", toolCount: 0 });
        continue;
      }
      try {
        const toolsResponse = await this.request(serverName, config, "tools/list", {});
        const definitions = Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : [];
        const mapped: ToolDefinition[] = [];

        for (const tool of definitions) {
          if (!tool || typeof tool.name !== "string") continue;
          const generatedName = makeMcpToolName(serverName, tool.name);
          this.toolMapping.set(generatedName, { serverName, originalToolName: tool.name });
          mapped.push({
            name: generatedName,
            description: `[MCP: ${serverName}] ${String(tool.description ?? tool.name)}`,
            input_schema:
              tool.inputSchema && typeof tool.inputSchema === "object"
                ? tool.inputSchema
                : { type: "object", properties: {} }
          });
        }

        this.tools.set(serverName, mapped);
        this.serverStatuses.set(serverName, {
          name: serverName,
          status: "connected",
          toolCount: mapped.length,
          transport: config.url ? "sse" : "stdio"
        });
        result.push(...mapped);
      } catch (err: any) {
        const errMsg = err?.message ?? String(err);
        logError(`[MCP:${serverName}] Failed to list tools: ${errMsg}`);
        this.serverStatuses.set(serverName, {
          name: serverName,
          status: "error",
          toolCount: 0,
          error: errMsg,
          transport: config.url ? "sse" : "stdio"
        });
      }
    }
    return result;
  }

  public isMcpTool(generatedName: string): boolean {
    return generatedName.startsWith("mcp_") || this.toolMapping.has(generatedName);
  }

  public getToolMapping(generatedName: string): { serverName: string; originalToolName: string } | undefined {
    return this.toolMapping.get(generatedName);
  }

  public async callTool(
    generatedName: string,
    input: Record<string, unknown>,
    servers: Record<string, McpServerConfig>,
    signal?: AbortSignal
  ): Promise<string> {
    const mapping = this.toolMapping.get(generatedName);
    let serverName = mapping?.serverName;
    let originalToolName = mapping?.originalToolName;

    if (!serverName || !originalToolName) {
      const match = /^mcp_([^_]+)_(.+)$/.exec(generatedName);
      if (!match) throw new Error(`Invalid MCP tool name: ${generatedName}`);
      serverName = match[1];
      originalToolName = match[2];
    }

    const config = servers[serverName];
    if (!config || config.disabled) {
      throw new Error(`MCP server '${serverName}' is not configured or is disabled.`);
    }

    logDebug(`[MCP:${serverName}] Calling tool '${originalToolName}' with args: ${JSON.stringify(input)}`);
    const response = await this.request(
      serverName,
      config,
      "tools/call",
      { name: originalToolName, arguments: input },
      signal
    );

    if (response?.isError) {
      const errContent = Array.isArray(response.content)
        ? response.content.map((p: any) => p?.text ?? JSON.stringify(p)).join("\n")
        : String(response.content ?? "Tool execution reported an error.");
      throw new Error(`[MCP ${serverName}:${originalToolName}] ${errContent}`);
    }

    const content = Array.isArray(response?.content) ? response.content : [response];
    return content
      .map((part: any) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        if (part.type === "text" && typeof part.text === "string") return part.text;
        if (part.type === "image") return `[Image: ${part.mimeType || "unknown"}]`;
        if (part.type === "resource") return `[Resource: ${part.resource?.uri || "unknown"}]`;
        return typeof part.text === "string" ? part.text : JSON.stringify(part);
      })
      .filter(Boolean)
      .join("\n");
  }

  public async listResources(servers: Record<string, McpServerConfig>): Promise<McpResource[]> {
    const result: McpResource[] = [];
    for (const [serverName, config] of Object.entries(servers)) {
      if (config.disabled) continue;
      try {
        const res = await this.request(serverName, config, "resources/list", {});
        const resources = Array.isArray(res?.resources) ? res.resources : [];
        for (const r of resources) {
          if (r && typeof r.uri === "string") {
            result.push({
              uri: r.uri,
              name: `[${serverName}] ${r.name || r.uri}`,
              description: r.description,
              mimeType: r.mimeType
            });
          }
        }
      } catch {
        /* Resource listing is optional */
      }
    }
    return result;
  }

  public async readResource(serverName: string, uri: string, servers: Record<string, McpServerConfig>): Promise<string> {
    const config = servers[serverName];
    if (!config || config.disabled) throw new Error(`MCP server '${serverName}' not found or is disabled.`);
    const res = await this.request(serverName, config, "resources/read", { uri });
    const contents = Array.isArray(res?.contents) ? res.contents : [res];
    return contents.map((c: any) => c?.text || (c?.blob ? `[Binary blob: ${c.blob.length} bytes]` : JSON.stringify(c))).join("\n");
  }

  public getServerStatuses(): McpServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  public async testServer(serverName: string, config: McpServerConfig): Promise<{ ok: boolean; message: string; tools: string[] }> {
    try {
      // Validate through the same live connection used by tool calls. Restarting here can
      // interrupt an active agent turn and makes slow stdio servers time out during startup.
      await this.listTools({ [serverName]: config });
      const status = this.serverStatuses.get(serverName);
      if (!status || status.status !== "connected") {
        return {
          ok: false,
          message: status?.error ?? "The MCP server did not connect successfully.",
          tools: []
        };
      }
      const tools = this.tools.get(serverName) ?? [];
      return {
        ok: true,
        message: `Successfully connected. Found ${tools.length} tool(s).`,
        tools: tools.map((t) => t.name)
      };
    } catch (err: any) {
      return {
        ok: false,
        message: err?.message ?? String(err),
        tools: []
      };
    }
  }

  public dispose(): void {
    for (const [, process] of this.processes.entries()) {
      killProcessTree(process);
    }
    this.processes.clear();
    this.initPromises.clear();
    for (const request of this.pending.values()) {
      request.reject(new Error("MCP client disposed."));
    }
    this.pending.clear();
    this.serverStatuses.clear();
    this.toolMapping.clear();
  }

  private cleanupServer(serverName: string): void {
    const process = this.processes.get(serverName);
    if (process) {
      killProcessTree(process);
      this.processes.delete(serverName);
    }
    this.initPromises.delete(serverName);
  }

  private async request(
    serverName: string,
    config: McpServerConfig,
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<any> {
    if (config.url) {
      return this.remoteRequest(serverName, config.url, config.headers, method, params, signal);
    }
    await this.ensureInitialized(serverName, config);
    const process = this.processes.get(serverName);
    if (!process || process.killed) {
      throw new Error(`MCP server '${serverName}' process is not running.`);
    }
    return this.rawRequest(serverName, process, method, params, signal);
  }

  private async remoteRequest(
    serverName: string,
    url: string,
    headers: Record<string, string> | undefined,
    method: string,
    params: unknown,
    signal?: AbortSignal,
    isRetry = false
  ): Promise<any> {
    const id = `${serverName}-${++this.sequence}`;
    const payload = { jsonrpc: "2.0", id, method, params };
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const resolvedUrl = resolveVariables(url, wsFolder);

    const mergedHeaders: Record<string, string> = { ...(headers || {}) };
    const isFigma = serverName.toLowerCase() === "figma" || resolvedUrl.includes("mcp.figma.com");

    if (isFigma && !mergedHeaders["Authorization"] && !mergedHeaders["authorization"] && this.figmaTokenProvider) {
      try {
        const token = await this.figmaTokenProvider();
        if (token) {
          mergedHeaders["Authorization"] = `Bearer ${token}`;
        }
      } catch (err) {
        logWarn(`[MCP:figma] Failed to retrieve Figma token: ${err}`);
      }
    }

    const res = await fetch(resolvedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...mergedHeaders
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      if (res.status === 401 && isFigma && !isRetry && this.figmaTokenRefresher) {
        logInfo("[MCP:figma] Received HTTP 401, attempting token refresh...");
        try {
          const refreshed = await this.figmaTokenRefresher();
          if (refreshed) {
            const retryHeaders = { ...headers, Authorization: `Bearer ${refreshed}` };
            return this.remoteRequest(serverName, url, retryHeaders, method, params, signal, true);
          }
        } catch (refreshErr) {
          logError(`[MCP:figma] Token refresh failed: ${refreshErr}`);
        }
      }

      if (res.status === 401 && isFigma) {
        throw new Error(
          `Remote MCP server 'figma' returned HTTP 401: Unauthorized. لطفاً از طریق بخش تنظیمات MCP روی «ورود با اکانت فیگما» کلیک کنید تا احراز هویت انجام شود.`
        );
      }

      if (res.status === 429 && isFigma) {
        throw new Error(
          `[Figma MCP Rate Limit] سقف مجاز درخواست‌های اکانت فیگما (Rate Limit) پر شده است. می‌توانید از سرور دسکتاپ Figma در Dev Mode (http://127.0.0.1:3845/mcp) استفاده کنید که بدون محدودیت کار می‌کند.`
        );
      }

      throw new Error(`Remote MCP server '${serverName}' returned HTTP ${res.status}: ${await res.text()}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as any;
      if (json.error) throw new Error(json.error.message || "Remote MCP request failed.");
      return json.result;
    }
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) throw new Error(parsed.error.message || "Remote MCP request failed.");
      return parsed.result;
    } catch {
      return text;
    }
  }

  private rawRequest(
    serverName: string,
    child: ChildProcessWithoutNullStreams,
    method: string,
    params: unknown,
    signal?: AbortSignal
  ): Promise<any> {
    if (signal?.aborted) {
      throw new Error(`MCP request '${method}' to '${serverName}' was aborted.`);
    }
    const id = `${serverName}-${++this.sequence}`;
    const response = new Promise<any>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' to '${serverName}' aborted by user.`));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`MCP request '${method}' to '${serverName}' timed out.`));
      }, 45_000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        }
      });
    });

    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    child.stdin.write(`${payload}\n`);
    return response;
  }

  private async ensureInitialized(serverName: string, config: McpServerConfig): Promise<void> {
    const existing = this.processes.get(serverName);
    if (existing && !existing.killed && this.initPromises.has(serverName)) {
      await this.initPromises.get(serverName);
      return;
    }

    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const command = resolveVariables(config.command || "", wsFolder);
    const args = (config.args ?? []).map((arg) => resolveVariables(arg, wsFolder));
    const resolvedEnv: Record<string, string> = {};
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        resolvedEnv[k] = resolveVariables(v, wsFolder);
      }
    }
    const resolvedCwd = config.cwd ? resolveVariables(config.cwd, wsFolder) : (wsFolder || process.cwd());

    if (!command.trim()) {
      throw new Error(`MCP server '${serverName}' has no command or url configured.`);
    }

    this.serverStatuses.set(serverName, { name: serverName, status: "connecting", toolCount: 0 });

    const child = spawn(command, args, {
      env: { ...process.env, ...resolvedEnv },
      cwd: resolvedCwd,
      shell: process.platform === "win32",
      windowsHide: true
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message?.id === undefined || message?.id === null) return;
        const request = this.pending.get(String(message.id));
        if (!request) return;
        this.pending.delete(String(message.id));
        if (message.error) {
          request.reject(new Error(message.error.message ?? "MCP request failed."));
        } else {
          request.resolve(message.result);
        }
      } catch {
        /* Ignore non-JSON server output on stdout */
      }
    });

    let stderrBuffer = "";
    const errLines = readline.createInterface({ input: child.stderr });
    errLines.on("line", (line) => {
      if (line.trim()) {
        stderrBuffer = (stderrBuffer ? stderrBuffer + "\n" + line : line).slice(-1000);
        logDebug(`[MCP:${serverName}:stderr] ${line}`);
      }
    });

    child.on("error", (err) => {
      logError(`[MCP:${serverName}] Spawn error: ${err.message}`);
      this.serverStatuses.set(serverName, {
        name: serverName,
        status: "error",
        toolCount: 0,
        error: err.message
      });
      for (const [id, req] of this.pending.entries()) {
        if (id.startsWith(`${serverName}-`)) {
          req.reject(new Error(`MCP server '${serverName}' spawn error: ${err.message}`));
          this.pending.delete(id);
        }
      }
      this.cleanupServer(serverName);
    });

    child.on("exit", (code) => {
      logDebug(`[MCP:${serverName}] Exited with code ${code}`);
      const errMsg = code ? `Exited with code ${code}${stderrBuffer ? ` (${stderrBuffer.trim()})` : ""}` : undefined;
      this.serverStatuses.set(serverName, {
        name: serverName,
        status: "stopped",
        toolCount: 0,
        error: errMsg
      });
      for (const [id, req] of this.pending.entries()) {
        if (id.startsWith(`${serverName}-`)) {
          req.reject(new Error(`MCP server '${serverName}' process exited (code ${code})${stderrBuffer ? `: ${stderrBuffer.trim()}` : ""}`));
          this.pending.delete(id);
        }
      }
      this.cleanupServer(serverName);
    });

    this.processes.set(serverName, child);

    // Perform initialize handshake strictly before letting other requests proceed
    const initPromise = (async () => {
      try {
        const initResult = await this.rawRequest(serverName, child, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "hooshyar", version: "0.4.3" }
        });
        logDebug(`[MCP:${serverName}] Initialized successfully: ${JSON.stringify(initResult?.serverInfo ?? {})}`);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
      } catch (err: any) {
        logError(`[MCP:${serverName}] Initialization handshake failed: ${err.message}`);
        this.cleanupServer(serverName);
        throw err;
      }
    })();

    this.initPromises.set(serverName, initPromise);
    await initPromise;
  }
}

/**
 * Parses raw JSON string or object for MCP servers safely with detailed validation feedback.
 */
export function parseMcpServersWithValidation(raw: unknown): { servers: Record<string, McpServerConfig>; error?: string } {
  if (!raw) return { servers: {} };
  try {
    let parsedValue: any;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === "{}" || trimmed === "null") return { servers: {} };
      try {
        parsedValue = JSON.parse(trimmed);
      } catch (e: any) {
        // Fallback: strip single-line comments, block comments and trailing commas (JSONC)
        const cleaned = trimmed
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^\\:])\/\/.*$/gm, "$1")
          .replace(/,\s*([\]}])/g, "$1");
        try {
          parsedValue = JSON.parse(cleaned);
        } catch {
          return { servers: {}, error: `Invalid JSON: ${e?.message ?? String(e)}` };
        }
      }
    } else if (typeof raw === "object") {
      parsedValue = raw;
    } else {
      return { servers: {}, error: "Expected JSON string or object" };
    }

    const parsed = parsedValue?.mcpServers ?? parsedValue?.servers ?? parsedValue;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { servers: {}, error: "JSON must be an object containing server definitions" };
    }
    const servers = (parsed.mcpServers && typeof parsed.mcpServers === "object") ? parsed.mcpServers : parsed;
    const entries = Object.entries(servers).filter(([, value]) => {
      return (
        !!value &&
        typeof value === "object" &&
        (typeof (value as McpServerConfig).command === "string" || typeof (value as McpServerConfig).url === "string")
      );
    });

    return { servers: Object.fromEntries(entries) as Record<string, McpServerConfig> };
  } catch (err: any) {
    return { servers: {}, error: err?.message ?? String(err) };
  }
}

/**
 * Parses raw JSON string or object for MCP servers safely.
 */
export function readMcpServers(raw: unknown): Record<string, McpServerConfig> {
  return parseMcpServersWithValidation(raw).servers;
}

/**
 * Loads project-level MCP configurations from workspace file (.hooshyar/mcp.json or .vscode/mcp.json).
 * Security: Respects VS Code Workspace Trust — disabled in untrusted workspaces.
 */
export async function loadWorkspaceMcpConfig(): Promise<Record<string, McpServerConfig>> {
  if (vscode.workspace.isTrusted === false) {
    logWarn("Workspace is untrusted. Workspace-level MCP servers (.hooshyar/mcp.json) are disabled for security.");
    return {};
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return {};
  const result: Record<string, McpServerConfig> = {};

  for (const folder of folders) {
    const candidates = [
      path.join(folder.uri.fsPath, ".hooshyar", "mcp.json"),
      path.join(folder.uri.fsPath, ".vscode", "mcp.json")
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const content = fs.readFileSync(candidate, "utf8");
          const parsed = readMcpServers(content);
          Object.assign(result, parsed);
        } catch (err) {
          logError(`Error reading MCP config from ${candidate}: ${err}`);
        }
      }
    }
  }
  return result;
}
