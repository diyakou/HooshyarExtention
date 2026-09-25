import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { ToolDefinition, TaskItem } from "./types";
import {
  DEFAULT_EXCLUDE_GLOB,
  EnvironmentPlatformInfo,
  IgnoreMatcher,
  buildHostCommandGuidance,
  buildWorkspaceGlob,
  getWorkspaceFolders,
  getTargetWorkspaceFolder,
  getEnvironmentPlatformInfo,
  matchesDepth,
  normalizeWorkspaceRelativePath,
  readTextFile,
  requireWorkspaceFolder,
  resolveWorkspaceUri,
  isSubpath
} from "./workspaceUtils";
import { captureWriteBackup } from "./writeBackup";
import { logInfo } from "./logger";
import { ripgrepSearch } from "./ripgrepSearch";
import { ApprovalManager } from "./approvalManager";
import { safeParseJsonToolInput } from "./toolCallParser";
import { McpManager, McpServerConfig } from "./mcpManager";
import { MemoryManager } from "./memoryManager";

const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/f\b/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  />\s*\/dev\/sd/i
];

export function buildToolDefinitions(opts: { enableShellTool: boolean; mcpTools?: ToolDefinition[] }): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "read_file",
      description: "Read the full text content of a file in the current workspace. Path must be relative to the workspace root.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative file path" } },
        required: ["path"]
      }
    },
    {
      name: "search_replace",
      description:
        "Apply targeted edits to an EXISTING file by replacing old_string with new_string. " +
        "Always use this tool when editing, modifying, fixing, or updating existing code instead of rewriting the entire file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          old_string: { type: "string", description: "Exact text to find (include 2-4 lines of context for uniqueness)" },
          new_string: { type: "string", description: "Replacement text" },
          replace_all: { type: "boolean", description: "Replace every occurrence. Default false." }
        },
        required: ["path", "old_string", "new_string"]
      }
    },
    {
      name: "write_file",
      description:
        "Create a brand NEW file with the given full content. " +
        "DO NOT use this tool to edit existing files — use search_replace instead to avoid wiping existing code. " +
        "Only use write_file if creating a file that doesn't exist yet or if the user explicitly asks for a full rewrite from scratch.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "Full new content of the file" }
        },
        required: ["path", "content"]
      }
    },
    {
      name: "list_files",
      description: "List files and directories under a workspace-relative directory (non-recursive).",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    },
    {
      name: "list_codebase",
      description: "Recursively list project files (respects .gitignore / .cursorignore).",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          glob: { type: "string" },
          depth: { type: "number" }
        }
      }
    },
    {
      name: "search_codebase",
      description: "Grep-like search across the workspace.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          glob: { type: "string" },
          is_regex: { type: "boolean" },
          depth: { type: "number" }
        },
        required: ["pattern"]
      }
    },
    {
      name: "update_tasks",
      description: "Update the visible task checklist (send FULL list each time).",
      input_schema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] }
              },
              required: ["id", "content", "status"]
            }
          }
        },
        required: ["tasks"]
      }
    },
    {
      name: "get_workspace_symbols",
      description: "Search for symbols (functions, classes, interfaces, methods, variables) across the entire workspace AST using Language Server Protocol.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Symbol name or substring to search for" }
        },
        required: ["query"]
      }
    },
    {
      name: "get_diagnostics",
      description: "Retrieve active compiler errors, type errors, linter diagnostics, and syntax warnings from the workspace Problems tab.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional workspace-relative file path to filter diagnostics for. If omitted, checks the entire workspace." },
          severity: { type: "string", enum: ["error", "warning", "all"], description: "Severity filter ('error', 'warning', or 'all'). Default is 'error'." }
        }
      }
    },
    {
      name: "fetch_webpage",
      description: "Fetch and read the text content of a web page, documentation URL, or GitHub resource over HTTP/HTTPS.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full HTTP or HTTPS URL to fetch" }
        },
        required: ["url"]
      }
    },
    {
      name: "manage_memory",
      description: "Manage persistent developer preferences, coding conventions, and architectural facts across sessions (actions: store, recall, delete, list).",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["store", "recall", "delete", "list"], description: "Action to perform" },
          key: { type: "string", description: "Category/Key name (e.g. 'styling', 'framework', 'testing')" },
          value: { type: "string", description: "Preference content to store (required for 'store')" }
        },
        required: ["action"]
      }
    },
    {
      name: "task_complete",
      description:
        "Signal that an agent task is fully complete after all requested work, verification, and task-list items are finished. Call this alone, after a concise final summary.",
      input_schema: {
        type: "object",
        properties: {}
      }
    }
  ];

  if (opts.enableShellTool) {
    const envInfo = getEnvironmentPlatformInfo();
    const osGuidance = buildHostCommandGuidance(envInfo);

    tools.push({
      name: "run_command",
      description:
        `Run a shell command, test suite (e.g. 'npm test', 'npm run compile', 'pytest'), or script in the workspace root or specified project directory and capture stdout/stderr output. ${osGuidance}`,
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute, compatible with the host operating system."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative directory or project folder to execute the command inside. Defaults to workspace root."
          },
          timeout_ms: {
            type: "number",
            minimum: 1000,
            maximum: 600000,
            description: "Optional timeout in milliseconds. Defaults to the hooshyar.commandTimeoutMs setting."
          }
        },
        required: ["command"]
      }
    });
    tools.push({
      name: "run_in_terminal",
      description:
        `Send a command to the interactive VS Code integrated terminal and reveal it to the user. Useful for dev servers, watching test outputs live, or commands the user should interact with. ${osGuidance}`,
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to run in the VS Code terminal."
          },
          path: {
            type: "string",
            description: "Optional project folder or directory to run the command in."
          }
        },
        required: ["command"]
      }
    });
  }

  if (opts.mcpTools && opts.mcpTools.length > 0) {
    tools.push(...opts.mcpTools);
  }

  return tools;
}

async function getIgnoreMatcher(folder: vscode.WorkspaceFolder): Promise<{ isIgnored: (p: string) => boolean }> {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (!cfg.get<boolean>("respectIgnoreFiles", true)) {
    return { isIgnored: () => false };
  }
  return IgnoreMatcher.forWorkspace(folder);
}

export async function readFileTool(input: { path?: string }): Promise<string> {
  const targetPath = typeof input?.path === "string" ? input.path.trim() : "";
  if (!targetPath) {
    throw new Error("read_file requires a non-empty 'path'.");
  }
  const { uri, relPath, folder } = resolveWorkspaceUri(targetPath);
  const ignore = await getIgnoreMatcher(folder);
  if (ignore.isIgnored(relPath)) {
    throw new Error(`Path is ignored by .gitignore/.cursorignore: ${relPath}`);
  }
  return readTextFile(uri);
}

export async function writeFileTool(input: { path?: unknown; content?: unknown }): Promise<string> {
  const filePath = typeof input?.path === "string" ? input.path.trim() : "";
  if (!filePath || filePath === "undefined" || filePath === "null") {
    throw new Error("write_file requires a valid, non-empty 'path'.");
  }
  const content =
    input?.content === undefined || input?.content === null
      ? ""
      : typeof input.content === "string"
      ? input.content
      : String(input.content);

  const maxWrite = vscode.workspace.getConfiguration("hooshyar").get<number>("maxWriteSizeBytes", 2_000_000);
  if (Buffer.byteLength(content, "utf-8") > maxWrite) {
    throw new Error(`Content exceeds max write size (${maxWrite} bytes).`);
  }

  if (/^(?:i've|i have|sure|here is|here's|من|با موفقیت|در ادامه|فایل|طبق درخواست)\b/i.test(content.trim())) {
    throw new Error(
      `Refusing to write assistant conversational response into '${filePath}'. ` +
      `Output only the raw file content, or use 'search_replace' for targeted changes.`
    );
  }

  const { uri } = resolveWorkspaceUri(filePath);

  // Check if file exists (new file vs. existing file)
  let isNewFile = false;
  let existingSize = 0;
  try {
    const existingBytes = await vscode.workspace.fs.readFile(uri);
    const existingText = Buffer.from(existingBytes).toString("utf-8");
    existingSize = existingText.length;
    
    // Safety guard: prevent accidentally wiping out an existing file with a partial snippet
    if (existingText.trim().length > 100 && content.length < existingText.length * 0.4) {
      throw new Error(
        `Refusing to overwrite existing file '${filePath}' (${existingText.length} chars) with a partial snippet (${content.length} chars). ` +
        `To edit specific lines or sections of an existing file without deleting the rest, use the 'search_replace' tool instead.`
      );
    }
  } catch (err: any) {
    if (err.message && err.message.includes("Refusing to overwrite")) {
      throw err;
    }
    // File doesn't exist or is not readable yet, which is expected for new files
    isNewFile = true;
  }

  // Check auto-approve logic
  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor?.document.uri.fsPath;
  const contentSize = Buffer.byteLength(content, "utf-8");
  
  const approvalDecision = ApprovalManager.shouldAutoApproveWrite(
    filePath,
    contentSize,
    isNewFile,
    activeFilePath
  );

  if (approvalDecision.shouldAutoApprove) {
    logInfo(`Auto-approved write_file: ${filePath} - ${approvalDecision.reason}`);
  }

  await captureWriteBackup(filePath);
  const dir = vscode.Uri.file(path.dirname(uri.fsPath));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
  logInfo(`write_file: ${filePath} (${content.length} chars)`);
  
  const status = approvalDecision.shouldAutoApprove 
    ? ` [auto-approved: ${approvalDecision.reason}]`
    : "";
  return `Wrote ${content.length} characters to ${filePath}${status}`;
}

export function findFuzzyLineMatch(fileLines: string[], targetLines: string[]): number {
  if (targetLines.length === 0 || fileLines.length < targetLines.length) return -1;

  // 1. Match with trailing whitespace trimmed on each line
  const normTargetTrailing = targetLines.map((l) => l.trimEnd());
  for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
    let match = true;
    for (let j = 0; j < targetLines.length; j++) {
      if (fileLines[i + j].trimEnd() !== normTargetTrailing[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }

  // 2. Match with both leading and trailing whitespace trimmed on each line (indentation-tolerant)
  const normTargetTrimmed = targetLines.map((l) => l.trim());
  if (normTargetTrimmed.some((l) => l.length > 0)) {
    for (let i = 0; i <= fileLines.length - targetLines.length; i++) {
      let match = true;
      for (let j = 0; j < targetLines.length; j++) {
        if (fileLines[i + j].trim() !== normTargetTrimmed[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
  }

  return -1;
}

export function applySearchReplace(
  rawText: string,
  oldString: string,
  newString: string,
  replaceAll = false
): { updatedText: string; count: number } {
  if (!oldString) throw new Error("search_replace requires non-empty 'old_string'.");
  if (oldString === newString) throw new Error("old_string and new_string are identical.");

  const isCrlf = rawText.includes("\r\n");
  const normalizedFileText = rawText.replace(/\r\n/g, "\n");
  const normalizedOld = oldString.replace(/\r\n/g, "\n");
  const normalizedNew = newString.replace(/\r\n/g, "\n");

  // 1. Direct match on raw text
  if (rawText.includes(oldString)) {
    const count = rawText.split(oldString).length - 1;
    const updated = replaceAll ? rawText.split(oldString).join(newString) : rawText.replace(oldString, newString);
    return { updatedText: updated, count: replaceAll ? count : 1 };
  }

  // 2. Normalized LF match
  if (normalizedFileText.includes(normalizedOld)) {
    const count = normalizedFileText.split(normalizedOld).length - 1;
    let updated = replaceAll
      ? normalizedFileText.split(normalizedOld).join(normalizedNew)
      : normalizedFileText.replace(normalizedOld, normalizedNew);
    if (isCrlf && !updated.includes("\r\n")) {
      updated = updated.replace(/\n/g, "\r\n");
    }
    return { updatedText: updated, count: replaceAll ? count : 1 };
  }

  // 3. Line-by-line whitespace-tolerant match
  const fileLines = normalizedFileText.split("\n");
  const oldLines = normalizedOld.split("\n");
  const matchIndex = findFuzzyLineMatch(fileLines, oldLines);
  if (matchIndex >= 0) {
    const beforeLines = fileLines.slice(0, matchIndex).join("\n");
    const afterLines = fileLines.slice(matchIndex + oldLines.length).join("\n");
    const prefix = beforeLines ? beforeLines + "\n" : "";
    const suffix = afterLines ? "\n" + afterLines : "";
    let updated = prefix + normalizedNew + suffix;
    if (isCrlf && !updated.includes("\r\n")) {
      updated = updated.replace(/\n/g, "\r\n");
    }
    return { updatedText: updated, count: 1 };
  }

  // 4. Trimmed block match (handles cases where old_string has extra leading/trailing blank lines)
  const trimmedOld = normalizedOld.trim();
  if (trimmedOld.length > 0 && normalizedFileText.includes(trimmedOld)) {
    const occurrences = normalizedFileText.split(trimmedOld).length - 1;
    if (occurrences === 1 || replaceAll) {
      const updated = replaceAll
        ? normalizedFileText.split(trimmedOld).join(normalizedNew.trim())
        : normalizedFileText.replace(trimmedOld, normalizedNew.trim());
      const finalUpdated = isCrlf && !updated.includes("\r\n") ? updated.replace(/\n/g, "\r\n") : updated;
      return { updatedText: finalUpdated, count: replaceAll ? occurrences : 1 };
    }
  }

  throw new Error(
    `old_string not found in file. Please ensure lines match the file (you can use read_file first to see current lines and indentation).`
  );
}

export async function searchReplaceTool(input: {
  path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}): Promise<string> {
  const filePath = input.path?.trim();
  if (!filePath) throw new Error("search_replace requires 'path'.");
  if (typeof input.old_string !== "string") throw new Error("search_replace requires 'old_string'.");
  if (typeof input.new_string !== "string") throw new Error("search_replace requires 'new_string'.");

  const { uri } = resolveWorkspaceUri(filePath);
  const rawText = await readTextFile(uri);

  const { updatedText, count } = applySearchReplace(rawText, input.old_string, input.new_string, Boolean(input.replace_all));

  // Check auto-approve logic for edits
  const activeEditor = vscode.window.activeTextEditor;
  const activeFilePath = activeEditor?.document.uri.fsPath;
  const contentSize = Buffer.byteLength(updatedText, "utf-8");
  
  const approvalDecision = ApprovalManager.shouldAutoApproveWrite(
    filePath,
    contentSize,
    false, // search_replace is always on existing files
    activeFilePath
  );

  if (approvalDecision.shouldAutoApprove) {
    logInfo(`Auto-approved search_replace: ${filePath} - ${approvalDecision.reason}`);
  }

  await captureWriteBackup(filePath);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedText, "utf-8"));
  const replaced = input.replace_all ? count : 1;
  logInfo(`search_replace: ${filePath} (${replaced} replacement(s))`);
  
  const status = approvalDecision.shouldAutoApprove 
    ? ` [auto-approved: ${approvalDecision.reason}]`
    : "";
  return `Successfully replaced ${replaced} occurrence(s) in ${filePath}${status}`;
}

export async function listFilesTool(input: { path?: string }): Promise<string> {
  const targetPath = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : ".";
  const folders = getWorkspaceFolders();

  // If in multi-root workspace and path is root "." or empty, list all open workspace folders
  if (folders.length > 1 && (targetPath === "." || targetPath === "./" || targetPath === "/")) {
    return (
      folders
        .map((f) => `[dir]  ${f.name} (project folder: ${f.uri.fsPath})`)
        .join("\n")
    );
  }

  const { uri } = resolveWorkspaceUri(targetPath);
  const entries = await vscode.workspace.fs.readDirectory(uri);
  return (
    entries
      .map(([name, type]) => `${type === vscode.FileType.Directory ? "[dir]  " : "[file] "}${name}`)
      .join("\n") || "(empty directory)"
  );
}

export async function listCodebaseTool(
  input: { path?: string; glob?: string; depth?: number } | undefined,
  maxFiles: number
): Promise<string> {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  let targetFolders = folders;
  let subPath = input?.path;

  if (folders.length > 1 && input?.path && input.path !== "." && input.path !== "./") {
    const trimmed = input.path.trim().replace(/\\/g, "/").replace(/^[\\/]+/, "");
    const firstSegment = trimmed.split("/")[0].toLowerCase();
    const matched = folders.find((f) => f.name.toLowerCase() === firstSegment);
    if (matched) {
      targetFolders = [matched];
      subPath = trimmed.includes("/") ? trimmed.slice(firstSegment.length + 1) : "";
    }
  }

  const allRelPaths: string[] = [];

  for (const folder of targetFolders) {
    const ignore = await getIgnoreMatcher(folder);
    const normalizedPath = normalizeWorkspaceRelativePath(subPath);
    const pattern = buildWorkspaceGlob(normalizedPath, input?.glob);
    const relPattern = new vscode.RelativePattern(folder, pattern);
    const uris = await vscode.workspace.findFiles(relPattern, DEFAULT_EXCLUDE_GLOB, maxFiles);
    const root = folder.uri.fsPath;

    const relPaths = uris
      .map((u) => path.relative(root, u.fsPath).split(path.sep).join("/"))
      .filter((relPath) => !ignore.isIgnored(relPath))
      .filter((relPath) => matchesDepth(relPath, normalizedPath, input?.depth))
      .map((relPath) => (folders.length > 1 && targetFolders.length > 1 ? `${folder.name}/${relPath}` : relPath));

    allRelPaths.push(...relPaths);
    if (allRelPaths.length >= maxFiles) break;
  }

  allRelPaths.sort();
  const cappedPaths = allRelPaths.slice(0, maxFiles);
  const suffix =
    cappedPaths.length >= maxFiles
      ? `\n... (capped at ${maxFiles} files, refine 'glob' or 'path' to narrow)`
      : "";
  return (cappedPaths.join("\n") || "(no files found)") + suffix;
}

export async function searchCodebaseTool(
  input: { pattern?: string; path?: string; glob?: string; is_regex?: boolean; depth?: number } | undefined,
  maxFiles: number
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (!input?.pattern?.trim()) {
    return 'search_codebase requires a "pattern" field.';
  }

  const rgResult = cfg.get<boolean>("useRipgrep", true)
    ? await ripgrepSearch({
        pattern: input.pattern,
        path: input.path,
        glob: input.glob,
        isRegex: input.is_regex,
        maxMatches: 200
      })
    : null;
  if (rgResult) return rgResult;

  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  let targetFolders = folders;
  let subPath = input?.path;

  if (folders.length > 1 && input?.path && input.path !== "." && input.path !== "./") {
    const trimmed = input.path.trim().replace(/\\/g, "/").replace(/^[\\/]+/, "");
    const firstSegment = trimmed.split("/")[0].toLowerCase();
    const matched = folders.find((f) => f.name.toLowerCase() === firstSegment);
    if (matched) {
      targetFolders = [matched];
      subPath = trimmed.includes("/") ? trimmed.slice(firstSegment.length + 1) : "";
    }
  }

  let matcher: (line: string) => boolean;
  if (input.is_regex) {
    let re: RegExp;
    try {
      re = new RegExp(input.pattern);
    } catch (err: any) {
      throw new Error(`Invalid regex: ${err?.message ?? err}`);
    }
    matcher = (line) => re.test(line);
  } else {
    const needle = input.pattern.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  }

  const results: string[] = [];
  const MAX_MATCHES = 200;

  for (const folder of targetFolders) {
    if (results.length >= MAX_MATCHES) break;
    const ignore = await getIgnoreMatcher(folder);
    const normalizedPath = normalizeWorkspaceRelativePath(subPath);
    const globPattern = buildWorkspaceGlob(normalizedPath, input?.glob);
    const relPattern = new vscode.RelativePattern(folder, globPattern);
    const uris = await vscode.workspace.findFiles(relPattern, DEFAULT_EXCLUDE_GLOB, maxFiles);
    const root = folder.uri.fsPath;

    for (const uri of uris) {
      if (results.length >= MAX_MATCHES) break;
      const innerRel = path.relative(root, uri.fsPath).split(path.sep).join("/");
      if (ignore.isIgnored(innerRel)) continue;
      if (!matchesDepth(innerRel, normalizedPath, input?.depth)) continue;

      let text: string;
      try {
        text = await readTextFile(uri);
      } catch {
        continue;
      }

      const displayRel = folders.length > 1 && targetFolders.length > 1 ? `${folder.name}/${innerRel}` : innerRel;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matcher(lines[i])) {
          results.push(`${displayRel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
          if (results.length >= MAX_MATCHES) break;
        }
      }
    }
  }

  if (results.length === 0) return "No matches found.";
  const suffix =
    results.length >= MAX_MATCHES ? `\n... (capped at ${MAX_MATCHES} matches)` : "";
  return results.join("\n") + suffix;
}

export function assertSafeCommand(command: string): void {
  const trimmed = command.trim();
  // Allow safe sequential chaining with "&&" by temporarily removing it for the operator check
  const withoutSafeAnd = trimmed.replace(/\s*&&\s*/g, " ");
  // Block dangerous command substitution like $(...) or `...`, backgrounding single & or pipes, and semicolon chaining
  if (/[;|`]/.test(withoutSafeAnd) || /\$\(/.test(withoutSafeAnd) || /(?<!&)&(?!&)/.test(trimmed)) {
    throw new Error(
      "Command chaining or shell operators (; | ` $( or single &) are not permitted for safety reasons. You may use && for chaining."
    );
  }
  const cfg = vscode.workspace?.getConfiguration ? vscode.workspace.getConfiguration("hooshyar") : undefined;
  const allowed = cfg ? cfg.get<string[]>("allowedShellCommands", []) : [];
  if (allowed.length > 0) {
    const ok = allowed.some((prefix) => trimmed.startsWith(prefix));
    if (!ok) {
      throw new Error(
        `Command not allowed. It must start with one of: ${allowed.join(", ")}`
      );
    }
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error("Command blocked by Hooshyar safety policy.");
    }
  }
}

function quotePowerShellEnvValue(value: string): string {
  const trimmed = value.trim();
  if (/^(['"]).*\1$/.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, "''")}'`;
}

function normalizeCommandSegmentForHost(segment: string, info: EnvironmentPlatformInfo): string {
  let cmd = segment.trim();
  if (!info.isWindows) return cmd;

  if (info.shellFamily === "powershell") {
    cmd = cmd.replace(/^source\s+([^\s]+)[/\\]bin[/\\]activate$/i, (_m, p) =>
      `& "${String(p).replace(/\//g, "\\")}\\Scripts\\Activate.ps1"`
    );
    cmd = cmd.replace(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/i, (_m, name, value) =>
      `$env:${name}=${quotePowerShellEnvValue(value)}`
    );
    cmd = cmd.replace(/^which\s+(.+)$/i, "Get-Command $1");
    cmd = cmd.replace(/^ls\s+-la(?:\s+(.+))?$/i, (_m, target) => `Get-ChildItem -Force${target ? ` ${target}` : ""}`);
    cmd = cmd.replace(/^cat\s+(.+)$/i, "Get-Content $1");
    cmd = cmd.replace(/^touch\s+(.+)$/i, "New-Item -ItemType File -Force $1");
    return cmd;
  }

  cmd = cmd.replace(/^source\s+([^\s]+)[/\\]bin[/\\]activate$/i, (_m, p) =>
    `call ${String(p).replace(/\//g, "\\")}\\Scripts\\activate.bat`
  );
  cmd = cmd.replace(/^source\s+/i, "call ");
  cmd = cmd.replace(/^export\s+([A-Za-z_][A-Za-z0-9_]*=)/i, "set $1");
  cmd = cmd.replace(/^which\s+/i, "where ");
  cmd = cmd.replace(/^ls\s+-la(?:\s+(.+))?$/i, (_m, target) => `dir /a${target ? ` ${target}` : ""}`);
  cmd = cmd.replace(/^cat\s+(.+)$/i, "type $1");
  return cmd;
}

export function normalizeCommandForHost(
  command: string,
  info: EnvironmentPlatformInfo = getEnvironmentPlatformInfo()
): string {
  return command
    .split(/\s*&&\s*/)
    .map((segment) => normalizeCommandSegmentForHost(segment, info))
    .join(" && ");
}

export function normalizeWindowsCommand(command: string): string {
  return normalizeCommandForHost(command);
}

export function resolveCommandTimeoutMs(requested?: unknown): number {
  const configured = vscode.workspace.getConfiguration("hooshyar").get<number>("commandTimeoutMs", 120_000);
  const candidate = typeof requested === "number" ? requested : Number(requested);
  const timeout = Number.isFinite(candidate) && candidate > 0 ? candidate : configured;
  return Math.min(600_000, Math.max(1_000, Math.round(timeout)));
}

function formatCommandOutput(exitCode: string | number, stdout: unknown, stderr: unknown): string {
  const outStr = String(stdout ?? "").trimEnd();
  const errStr = String(stderr ?? "").trimEnd();
  return [
    `Exit code: ${exitCode}`,
    `STDOUT:\n${outStr || "(no output)"}`,
    `STDERR:\n${errStr || "(no output)"}`
  ].join("\n");
}

export function runCommandTool(input: { command: string; path?: string; timeout_ms?: number }, signal?: AbortSignal): Promise<string> {
  const normalizedCommand = normalizeCommandForHost(input.command);
  assertSafeCommand(normalizedCommand);
  const targetFolder = getTargetWorkspaceFolder(input.path);
  let root = targetFolder.uri.fsPath;
  if (input.path) {
    try {
      const { uri } = resolveWorkspaceUri(input.path);
      root = uri.fsPath;
    } catch {
      // fallback to targetFolder.uri.fsPath
    }
  }
  logInfo(`run_command: ${normalizedCommand} in ${root}`);

  if (signal?.aborted) {
    return Promise.reject(new Error("Command cancelled by user."));
  }

  const envInfo = getEnvironmentPlatformInfo();
  const timeoutMs = resolveCommandTimeoutMs(input.timeout_ms);
  const execOptions: any = {
    cwd: root,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    detached: !envInfo.isWindows
  };
  if (envInfo.isWindows && envInfo.shellPath) {
    execOptions.shell = envInfo.shellPath;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let onAbort: (() => void) | undefined;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(result || "Exit code: 0\nSTDOUT:\n(no output)\nSTDERR:\n(no output)");
    };

    const child = exec(normalizedCommand, execOptions, (err, stdout, stderr) => {
      if (signal?.aborted) {
        finish(new Error("Command cancelled by user."));
        return;
      }
      if (err) {
        const timedOut = Boolean((err as any).killed) && (err as any).signal === "SIGTERM";
        const prefix = timedOut ? `Command timed out after ${timeoutMs}ms.` : "Command failed.";
        finish(new Error(`${prefix}\n${formatCommandOutput((err as any).code ?? "unknown", stdout, stderr)}`));
      } else {
        finish(undefined, formatCommandOutput(0, stdout, stderr));
      }
    });

    if (signal) {
      onAbort = () => {
        if (child.pid) {
          if (process.platform === "win32") {
            exec(`taskkill /pid ${child.pid} /T /F`, () => {});
          } else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {}
            }
          }
        }
        finish(new Error("Command cancelled by user."));
      };

      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function runInTerminalTool(input: { command: string; path?: string }): Promise<string> {
  const cmd = String(input?.command || "").trim();
  if (!cmd) throw new Error("Command is required for run_in_terminal.");
  const normalizedCmd = normalizeCommandForHost(cmd);
  assertSafeCommand(normalizedCmd);

  let targetCwd: string | undefined;
  if (input.path) {
    try {
      const { uri } = resolveWorkspaceUri(input.path);
      targetCwd = uri.fsPath;
    } catch {
      /* ignore */
    }
  }

  const termName = "Hooshyar Terminal";
  let existingTerm = (vscode.window.terminals || []).find((t: any) => t.name === termName);
  let term = existingTerm;
  if (!term) {
    term = vscode.window.createTerminal({
      name: termName,
      cwd: targetCwd
    });
  } else if (targetCwd) {
    term.sendText(`cd "${targetCwd}"`, true);
  }
  term.show(true);
  term.sendText(normalizedCmd, true);
  return Promise.resolve(`Successfully sent command to Hooshyar Terminal: ${normalizedCmd}`);
}

export interface ToolExecContext {
  maxCodebaseFiles: number;
  onTaskUpdate: (tasks: TaskItem[]) => void;
  mcpManager?: McpManager;
  mcpServers?: Record<string, McpServerConfig>;
  signal?: AbortSignal;
}

export function normalizeToolInput(
  name: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  let rawObj: Record<string, unknown> = { ...(input || {}) };

  // 0. Unpack nested containers commonly produced by various LLM providers/proxies
  if (typeof rawObj.arguments === "string") {
    const parsedArgs = safeParseJsonToolInput(rawObj.arguments);
    rawObj = { ...rawObj, ...parsedArgs };
  } else if (rawObj.arguments && typeof rawObj.arguments === "object" && !Array.isArray(rawObj.arguments)) {
    rawObj = { ...rawObj, ...(rawObj.arguments as Record<string, unknown>) };
  }

  if (rawObj.parameters && typeof rawObj.parameters === "object" && !Array.isArray(rawObj.parameters)) {
    rawObj = { ...rawObj, ...(rawObj.parameters as Record<string, unknown>) };
  }

  if (rawObj.input && typeof rawObj.input === "object" && !Array.isArray(rawObj.input)) {
    rawObj = { ...rawObj, ...(rawObj.input as Record<string, unknown>) };
  }

  if (rawObj.properties && typeof rawObj.properties === "object" && !Array.isArray(rawObj.properties)) {
    rawObj = { ...rawObj, ...(rawObj.properties as Record<string, unknown>) };
  }

  if (rawObj.function && typeof rawObj.function === "object" && !Array.isArray(rawObj.function)) {
    const fnObj = rawObj.function as Record<string, unknown>;
    if (typeof fnObj.arguments === "string") {
      const parsedFn = safeParseJsonToolInput(fnObj.arguments);
      rawObj = { ...rawObj, ...parsedFn };
    } else if (fnObj.arguments && typeof fnObj.arguments === "object" && !Array.isArray(fnObj.arguments)) {
      rawObj = { ...rawObj, ...(fnObj.arguments as Record<string, unknown>) };
    }
  }

  const norm: Record<string, unknown> = { ...rawObj };

  // 1. Path normalization across tools
  let rawPath =
    rawObj?.path ??
    rawObj?.cwd ??
    rawObj?.file_path ??
    rawObj?.filePath ??
    rawObj?.file ??
    rawObj?.file_name ??
    rawObj?.fileName ??
    rawObj?.filename ??
    rawObj?.target_file ??
    rawObj?.targetFile ??
    rawObj?.target ??
    rawObj?.dir ??
    rawObj?.directory ??
    rawObj?.folder;

  // Fallback: if tool is file-oriented and rawPath is missing, check rawObj.name if it resembles a file path
  if (!rawPath && typeof rawObj?.name === "string" && (name === "write_file" || name === "read_file" || name === "search_replace")) {
    const cand = rawObj.name.trim();
    if (cand && cand !== name && cand !== "write_file" && cand !== "read_file" && cand !== "search_replace" && cand.includes(".")) {
      rawPath = cand;
    }
  }

  if (typeof rawPath === "string") {
    let p = rawPath.trim();
    if (p === "undefined" || p === "null") {
      delete norm.path;
    } else {
      if (p.startsWith("./") || p.startsWith(".\\")) {
        p = p.slice(2);
      }
      norm.path = p;
    }
  } else if ((name === "list_files" || name === "list_codebase") && !norm.path) {
    norm.path = ".";
  }

  if (name === "run_command") {
    const rawTimeout = rawObj.timeout_ms ?? rawObj.timeoutMs ?? rawObj.timeout;
    if (rawTimeout !== undefined) norm.timeout_ms = Number(rawTimeout);
  }

  // 2. search_replace normalization
  const rawOld =
    rawObj?.old_string ??
    rawObj?.oldString ??
    rawObj?.old_text ??
    rawObj?.oldText ??
    rawObj?.search ??
    rawObj?.find ??
    rawObj?.original ??
    rawObj?.target_string;
  if (rawOld !== undefined) norm.old_string = String(rawOld);

  const rawNew =
    rawObj?.new_string ??
    rawObj?.newString ??
    rawObj?.new_text ??
    rawObj?.newText ??
    rawObj?.replace ??
    rawObj?.replacement ??
    rawObj?.replacement_content;
  if (rawNew !== undefined) norm.new_string = String(rawNew);

  if (rawObj?.replace_all !== undefined) {
    norm.replace_all = Boolean(rawObj.replace_all);
  } else if (rawObj?.replaceAll !== undefined) {
    norm.replace_all = Boolean(rawObj.replaceAll);
  }

  // 3. write_file content normalization
  const rawContent =
    rawObj?.content ??
    rawObj?.text ??
    rawObj?.file_content ??
    rawObj?.fileContent ??
    rawObj?.code ??
    rawObj?.body;
  if (rawContent !== undefined && typeof rawContent === "string") {
    norm.content = rawContent;
  }

  // 4. search_codebase pattern normalization
  const rawPattern =
    rawObj?.pattern ??
    rawObj?.query ??
    rawObj?.search ??
    rawObj?.regex ??
    rawObj?.needle;
  if (rawPattern !== undefined) norm.pattern = String(rawPattern);

  // 5. run_command command normalization
  const rawCommand = rawObj?.command ?? rawObj?.cmd ?? rawObj?.exec;
  if (rawCommand !== undefined) norm.command = String(rawCommand);

  return norm;
}

export async function getWorkspaceSymbolsTool(input: { query?: string }): Promise<string> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) {
    throw new Error("get_workspace_symbols requires a non-empty 'query'.");
  }
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query
  );
  if (!symbols || symbols.length === 0) {
    return `No symbols found matching "${query}".`;
  }
  const kindNames: Record<number, string> = {
    [vscode.SymbolKind.File]: "File",
    [vscode.SymbolKind.Module]: "Module",
    [vscode.SymbolKind.Namespace]: "Namespace",
    [vscode.SymbolKind.Package]: "Package",
    [vscode.SymbolKind.Class]: "Class",
    [vscode.SymbolKind.Method]: "Method",
    [vscode.SymbolKind.Property]: "Property",
    [vscode.SymbolKind.Field]: "Field",
    [vscode.SymbolKind.Constructor]: "Constructor",
    [vscode.SymbolKind.Enum]: "Enum",
    [vscode.SymbolKind.Interface]: "Interface",
    [vscode.SymbolKind.Function]: "Function",
    [vscode.SymbolKind.Variable]: "Variable",
    [vscode.SymbolKind.Constant]: "Constant",
    [vscode.SymbolKind.String]: "String",
    [vscode.SymbolKind.Number]: "Number",
    [vscode.SymbolKind.Boolean]: "Boolean",
    [vscode.SymbolKind.Array]: "Array",
    [vscode.SymbolKind.Object]: "Object",
    [vscode.SymbolKind.Key]: "Key",
    [vscode.SymbolKind.Null]: "Null",
    [vscode.SymbolKind.EnumMember]: "EnumMember",
    [vscode.SymbolKind.Struct]: "Struct",
    [vscode.SymbolKind.Event]: "Event",
    [vscode.SymbolKind.Operator]: "Operator",
    [vscode.SymbolKind.TypeParameter]: "TypeParameter"
  };
  const folders = getWorkspaceFolders();
  const maxResults = 35;
  const lines = symbols.slice(0, maxResults).map((s) => {
    const kind = kindNames[s.kind] ?? "Symbol";
    let relPath = s.location.uri.fsPath;
    for (const f of folders) {
      if (isSubpath(f.uri.fsPath, s.location.uri.fsPath)) {
        relPath = path.relative(f.uri.fsPath, s.location.uri.fsPath).replace(/\\/g, "/");
        break;
      }
    }
    const line = s.location.range.start.line + 1;
    const container = s.containerName ? ` (in ${s.containerName})` : "";
    return `- [${kind}] ${s.name}${container} -> ${relPath}:${line}`;
  });
  const extra = symbols.length > maxResults ? `\n... (${symbols.length - maxResults} more matches truncated)` : "";
  return `Found ${symbols.length} symbol(s) for "${query}":\n${lines.join("\n")}${extra}`;
}

export async function getDiagnosticsTool(input: { path?: string; severity?: "error" | "warning" | "all" }): Promise<string> {
  const targetPath = typeof input?.path === "string" ? input.path.trim() : "";
  const severityFilter = input?.severity ?? "error";

  let targetUri: vscode.Uri | undefined;
  if (targetPath) {
    targetUri = resolveWorkspaceUri(targetPath).uri;
  }

  const allDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = targetUri
    ? [[targetUri, vscode.languages.getDiagnostics(targetUri)]]
    : (vscode.languages.getDiagnostics() as unknown as [vscode.Uri, vscode.Diagnostic[]][]);

  const folders = getWorkspaceFolders();
  const results: string[] = [];

  for (const [uri, diags] of allDiagnostics) {
    if (!diags || diags.length === 0) continue;
    let relPath = uri.fsPath;
    for (const f of folders) {
      if (isSubpath(f.uri.fsPath, uri.fsPath)) {
        relPath = path.relative(f.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
        break;
      }
    }

    for (const d of diags) {
      const isError = d.severity === vscode.DiagnosticSeverity.Error;
      const isWarning = d.severity === vscode.DiagnosticSeverity.Warning;
      if (severityFilter === "error" && !isError) continue;
      if (severityFilter === "warning" && !isWarning) continue;

      const sevLabel = isError ? "ERROR" : isWarning ? "WARNING" : "INFO";
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      const source = d.source ? `[${d.source}] ` : (d.code ? `[${d.code}] ` : "");
      results.push(`- ${relPath}:${line}:${col} [${sevLabel}] ${source}${d.message}`);
    }
  }

  if (results.length === 0) {
    return targetPath
      ? `No diagnostics found for ${targetPath} (matching severity: ${severityFilter}).`
      : `No diagnostics found in workspace (matching severity: ${severityFilter}). Everything looks clean!`;
  }

  const maxShown = 40;
  const shown = results.slice(0, maxShown);
  const extra = results.length > maxShown ? `\n... (${results.length - maxShown} more diagnostics truncated)` : "";
  return `Diagnostics (${results.length} item(s)):\n${shown.join("\n")}${extra}`;
}

export function cleanHtmlToMarkdown(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
    .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n#### $1\n")
    .replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchWebpageTool(input: { url?: string }, signal?: AbortSignal): Promise<string> {
  const urlStr = typeof input?.url === "string" ? input.url.trim() : "";
  if (!urlStr || (!urlStr.startsWith("http://") && !urlStr.startsWith("https://"))) {
    throw new Error("fetch_webpage requires a valid HTTP or HTTPS 'url'.");
  }

  const response = await fetch(urlStr, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7"
    },
    signal
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch webpage (HTTP ${response.status}: ${response.statusText})`);
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  let formatted = contentType.includes("html") ? cleanHtmlToMarkdown(rawText) : rawText.trim();
  const maxLen = 25_000;
  if (formatted.length > maxLen) {
    formatted = formatted.slice(0, maxLen) + "\n\n... (content truncated at 25,000 chars)";
  }
  return formatted || "Webpage was empty or contained no text content.";
}

export async function manageMemoryTool(input: {
  action?: "store" | "recall" | "delete" | "list";
  key?: string;
  value?: string;
}): Promise<string> {
  const memory = MemoryManager.getInstance();
  const action = input?.action ?? "list";

  switch (action) {
    case "store": {
      if (!input?.key || !input?.value) {
        throw new Error("manage_memory store action requires both 'key' and 'value'.");
      }
      await memory.store(input.key, input.value);
      return `Stored preference for "${input.key}": "${input.value}"`;
    }
    case "recall": {
      if (!input?.key) {
        throw new Error("manage_memory recall action requires 'key'.");
      }
      const val = memory.recall(input.key);
      return val !== undefined ? `Memory for "${input.key}": ${val}` : `No memory found for "${input.key}".`;
    }
    case "delete": {
      if (!input?.key) {
        throw new Error("manage_memory delete action requires 'key'.");
      }
      const deleted = await memory.delete(input.key);
      return deleted ? `Deleted memory for "${input.key}".` : `No memory found for "${input.key}".`;
    }
    case "list":
    default: {
      const all = memory.list();
      const keys = Object.keys(all);
      if (keys.length === 0) return "No persistent memories or preferences stored yet.";
      const lines = keys.map((k) => `- **${k}**: ${all[k]}`);
      return `Persistent Memories (${keys.length}):\n${lines.join("\n")}`;
    }
  }
}

export async function executeTool(
  name: string,
  rawInput: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<string> {
  const input = normalizeToolInput(name, rawInput);
  switch (name) {
    case "read_file":
      return readFileTool(input as any);
    case "write_file":
      return writeFileTool(input as any);
    case "search_replace":
      return searchReplaceTool(input as any);
    case "list_files":
      return listFilesTool(input as any);
    case "list_codebase":
      return listCodebaseTool(input as any, ctx.maxCodebaseFiles);
    case "search_codebase":
      return searchCodebaseTool(input as any, ctx.maxCodebaseFiles);
    case "run_command":
      return runCommandTool(input as any, ctx.signal);
    case "run_in_terminal":
      return runInTerminalTool(input as any);
    case "update_tasks": {
      const tasks = (input as any).tasks as TaskItem[];
      ctx.onTaskUpdate(Array.isArray(tasks) ? tasks : []);
      return `Task list updated (${Array.isArray(tasks) ? tasks.length : 0} tasks).`;
    }
    case "get_workspace_symbols":
      return getWorkspaceSymbolsTool(input as any);
    case "get_diagnostics":
      return getDiagnosticsTool(input as any);
    case "fetch_webpage":
      return fetchWebpageTool(input as any, ctx.signal);
    case "manage_memory":
      return manageMemoryTool(input as any);
    case "task_complete":
      return "Task completion acknowledged.";
    default: {
      if (name.startsWith("mcp_") || (ctx.mcpManager && ctx.mcpManager.isMcpTool(name))) {
        if (!ctx.mcpManager || !ctx.mcpServers) {
          throw new Error(`MCP tool '${name}' invoked, but MCP servers are not configured or available.`);
        }
        return ctx.mcpManager.callTool(name, input, ctx.mcpServers, ctx.signal);
      }
      throw new Error(`Unknown tool: ${name}`);
    }
  }
}

export function isMcpMutatingTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("write") ||
    lower.includes("create") ||
    lower.includes("delete") ||
    lower.includes("remove") ||
    lower.includes("execute") ||
    lower.includes("run") ||
    lower.includes("update") ||
    lower.includes("edit") ||
    lower.includes("patch") ||
    lower.includes("destroy")
  );
}

export function isMutatingTool(name: string): boolean {
  if (name === "write_file" || name === "search_replace" || name === "run_command" || name === "run_in_terminal") return true;
  if (name.startsWith("mcp_")) return isMcpMutatingTool(name);
  return false;
}

export function isParallelSafeTool(name: string): boolean {
  return (
    name === "read_file" ||
    name === "list_files" ||
    name === "search_codebase" ||
    name === "get_workspace_symbols" ||
    name === "get_diagnostics" ||
    name === "fetch_webpage"
  );
}

export function listWorkspaceRootsSummary(): string {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) return "(no workspace)";
  return folders.map((f) => `${f.name}: ${f.uri.fsPath}`).join("\n");
}
