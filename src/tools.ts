import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { ToolDefinition, TaskItem } from "./types";
import {
  DEFAULT_EXCLUDE_GLOB,
  IgnoreMatcher,
  buildWorkspaceGlob,
  getWorkspaceFolders,
  matchesDepth,
  normalizeWorkspaceRelativePath,
  readTextFile,
  requireWorkspaceFolder,
  resolveWorkspaceUri
} from "./workspaceUtils";
import { captureWriteBackup } from "./writeBackup";
import { logInfo } from "./logger";
import { ripgrepSearch } from "./ripgrepSearch";

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

export function buildToolDefinitions(opts: { enableShellTool: boolean }): ToolDefinition[] {
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
      name: "write_file",
      description:
        "Create or overwrite a file with the given FULL content. Prefer search_replace for small edits.",
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
      name: "search_replace",
      description:
        "Replace one exact string occurrence in a file (or all if replace_all is true). " +
        "Use for targeted edits instead of rewriting entire files.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string", description: "Exact text to find (must match including whitespace)" },
          new_string: { type: "string", description: "Replacement text" },
          replace_all: { type: "boolean", description: "Replace every occurrence. Default false." }
        },
        required: ["path", "old_string", "new_string"]
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
    }
  ];

  if (opts.enableShellTool) {
    tools.push({
      name: "run_command",
      description: "Run a shell command in the workspace root. Blocked if it matches dangerous patterns.",
      input_schema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    });
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

export async function readFileTool(input: { path: string }): Promise<string> {
  const { uri, relPath, folder } = resolveWorkspaceUri(input.path);
  const ignore = await getIgnoreMatcher(folder);
  if (ignore.isIgnored(relPath)) {
    throw new Error(`Path is ignored by .gitignore/.cursorignore: ${relPath}`);
  }
  return readTextFile(uri);
}

export async function writeFileTool(input: { path?: unknown; content?: unknown }): Promise<string> {
  const filePath = typeof input?.path === "string" ? input.path.trim() : "";
  if (!filePath) {
    throw new Error("write_file requires a non-empty 'path'.");
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

  await captureWriteBackup(filePath);
  const { uri } = resolveWorkspaceUri(filePath);
  const dir = vscode.Uri.file(path.dirname(uri.fsPath));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
  logInfo(`write_file: ${filePath} (${content.length} chars)`);
  return `Wrote ${content.length} characters to ${filePath}`;
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
  if (input.old_string === input.new_string) {
    throw new Error("old_string and new_string are identical.");
  }

  const { uri } = resolveWorkspaceUri(filePath);
  const text = await readTextFile(uri);
  const count = text.split(input.old_string).length - 1;
  if (count === 0) {
    throw new Error(`old_string not found in ${filePath}.`);
  }

  await captureWriteBackup(filePath);
  const updated = input.replace_all
    ? text.split(input.old_string).join(input.new_string)
    : text.replace(input.old_string, input.new_string);

  await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf-8"));
  const replaced = input.replace_all ? count : 1;
  logInfo(`search_replace: ${filePath} (${replaced} replacement(s))`);
  return `Replaced ${replaced} occurrence(s) in ${filePath}`;
}

export async function listFilesTool(input: { path: string }): Promise<string> {
  const { uri } = resolveWorkspaceUri(input.path);
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
  const folder = requireWorkspaceFolder();
  const ignore = await getIgnoreMatcher(folder);
  const normalizedPath = normalizeWorkspaceRelativePath(input?.path);
  const pattern = buildWorkspaceGlob(normalizedPath, input?.glob);
  const uris = await vscode.workspace.findFiles(pattern, DEFAULT_EXCLUDE_GLOB, maxFiles);
  const root = folder.uri.fsPath;

  const relPaths = uris
    .map((u) => path.relative(root, u.fsPath).split(path.sep).join("/"))
    .filter((relPath) => !ignore.isIgnored(relPath))
    .filter((relPath) => matchesDepth(relPath, normalizedPath, input?.depth))
    .sort();

  const suffix =
    relPaths.length >= maxFiles
      ? `\n... (capped at ${maxFiles} files, refine 'glob' or 'path' to narrow)`
      : "";
  return (relPaths.join("\n") || "(no files found)") + suffix;
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

  const folder = requireWorkspaceFolder();
  const ignore = await getIgnoreMatcher(folder);
  const normalizedPath = normalizeWorkspaceRelativePath(input?.path);
  const globPattern = buildWorkspaceGlob(normalizedPath, input?.glob);
  const uris = await vscode.workspace.findFiles(globPattern, DEFAULT_EXCLUDE_GLOB, maxFiles);
  const root = folder.uri.fsPath;

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

  for (const uri of uris) {
    if (results.length >= MAX_MATCHES) break;
    const relPath = path.relative(root, uri.fsPath).split(path.sep).join("/");
    if (ignore.isIgnored(relPath)) continue;
    if (!matchesDepth(relPath, normalizedPath, input?.depth)) continue;

    let text: string;
    try {
      text = await readTextFile(uri);
    } catch {
      continue;
    }

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matcher(lines[i])) {
        results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
        if (results.length >= MAX_MATCHES) break;
      }
    }
  }

  if (results.length === 0) return "No matches found.";
  const suffix =
    results.length >= MAX_MATCHES ? `\n... (capped at ${MAX_MATCHES} matches)` : "";
  return results.join("\n") + suffix;
}

function assertSafeCommand(command: string): void {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  const allowed = cfg.get<string[]>("allowedShellCommands", []);
  if (allowed.length > 0) {
    const ok = allowed.some((prefix) => command.trimStart().startsWith(prefix));
    if (!ok) {
      throw new Error(
        `Command not allowed. It must start with one of: ${allowed.join(", ")}`
      );
    }
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error("Command blocked by Hooshyar safety policy.");
    }
  }
}

export function runCommandTool(input: { command: string }): Promise<string> {
  assertSafeCommand(input.command);
  const root = requireWorkspaceFolder().uri.fsPath;
  logInfo(`run_command: ${input.command}`);
  return new Promise((resolve) => {
    exec(input.command, { cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve(`Exit code ${err.code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
      } else {
        resolve(stdout || "(no output)");
      }
    });
  });
}

export interface ToolExecContext {
  maxCodebaseFiles: number;
  onTaskUpdate: (tasks: TaskItem[]) => void;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolExecContext
): Promise<string> {
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
      return runCommandTool(input as any);
    case "update_tasks": {
      const tasks = (input as any).tasks as TaskItem[];
      ctx.onTaskUpdate(tasks);
      return `Task list updated (${tasks.length} tasks).`;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function isMutatingTool(name: string): boolean {
  return name === "write_file" || name === "search_replace" || name === "run_command";
}

export function listWorkspaceRootsSummary(): string {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) return "(no workspace)";
  return folders.map((f) => `${f.name}: ${f.uri.fsPath}`).join("\n");
}
