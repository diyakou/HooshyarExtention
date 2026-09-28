import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";

export const DEFAULT_EXCLUDE_GLOB =
  "**/{node_modules,out,dist,build,.git,.venv,venv,__pycache__,.next,.turbo,coverage}/**";

export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders;

  // VS Code also lets users open individual files without opening a folder/workspace.
  // Treat the active local file's containing directory as a single-folder workspace so
  // read/edit/search tools can still operate on the file the user has open.
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    const root = path.dirname(activeUri.fsPath);
    return [
      {
        uri: vscode.Uri.file(root),
        name: path.basename(root),
        index: 0
      } as vscode.WorkspaceFolder
    ];
  }

  return [];
}

export interface EnvironmentPlatformInfo {
  os: string;
  platform: string;
  shell: string;
  shellPath: string;
  shellFamily: "powershell" | "cmd" | "posix";
  isWindows: boolean;
}

export function getEnvironmentPlatformInfo(): EnvironmentPlatformInfo {
  const isWindows = process.platform === "win32";
  const os = isWindows ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const shellPath =
    (typeof vscode !== "undefined" && vscode.env?.shell) ||
    (isWindows ? process.env.ComSpec || "powershell.exe" : process.env.SHELL || "/bin/bash");
  const shell = path.basename(shellPath).replace(/\.exe$/i, "").toLowerCase();
  const shellFamily = isWindows
    ? /^(?:powershell|pwsh)$/.test(shell) ? "powershell" : "cmd"
    : "posix";
  return {
    os,
    platform: process.platform,
    shell,
    shellPath,
    shellFamily,
    isWindows
  };
}

export function buildHostCommandGuidance(info: EnvironmentPlatformInfo): string {
  const heading = `Host OS is ${info.os} (${info.platform}); active terminal shell is ${info.shell} (${info.shellPath}).`;
  if (info.shellFamily === "powershell") {
    return (
      `${heading} Generate PowerShell commands only, not Linux/bash or CMD syntax. ` +
      "Use Get-ChildItem, Get-Content, Remove-Item, New-Item, Get-Command, $env:NAME='value', and " +
      ".\\.venv\\Scripts\\Activate.ps1. Prefer cross-platform project commands such as npm, node, python, and git."
    );
  }
  if (info.shellFamily === "cmd") {
    return (
      `${heading} Generate Windows CMD commands only, not Linux/bash or PowerShell syntax. ` +
      "Use dir, type, del/rmdir, where, set NAME=value, and call .venv\\Scripts\\activate.bat. " +
      "Prefer cross-platform project commands such as npm, node, python, and git."
    );
  }
  return (
    `${heading} Generate POSIX commands compatible with ${info.shell}; do not output PowerShell or CMD syntax. ` +
    "Prefer portable project commands such as npm, node, python, git, and standard POSIX utilities."
  );
}

export function getTargetWorkspaceFolder(targetPath?: string): vscode.WorkspaceFolder {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  if (!targetPath || folders.length === 1) {
    const active = vscode.window.activeTextEditor;
    if (active) {
      const found = folders.find((f) => isSubpath(f.uri.fsPath, active.document.uri.fsPath));
      if (found) return found;
    }
    return folders[0];
  }
  const trimmed = targetPath.trim().replace(/\\/g, "/").replace(/^[\\/]+/, "");
  const firstSegment = trimmed.split("/")[0].toLowerCase();
  const matched = folders.find(
    (f) => f.name.toLowerCase() === firstSegment || isSubpath(f.uri.fsPath, targetPath)
  );
  return matched || folders[0];
}

export function requireWorkspaceFolder(targetPath?: string): vscode.WorkspaceFolder {
  return getTargetWorkspaceFolder(targetPath);
}

export function normalizeFsPath(filePath: string): string {
  let cleaned = filePath.trim().replace(/\\/g, "/");
  if (process.platform === "win32") {
    if (/^\/[a-zA-Z]:/.test(cleaned)) {
      cleaned = cleaned.slice(1);
    }
  }
  return path.normalize(cleaned);
}

export function isSubpath(parent: string, child: string): boolean {
  const normParent = normalizeFsPath(parent);
  const normChild = normalizeFsPath(child);
  if (process.platform === "win32") {
    const pLower = normParent.toLowerCase();
    const cLower = normChild.toLowerCase();
    return cLower === pLower || cLower.startsWith(pLower.endsWith(path.sep) ? pLower : pLower + path.sep);
  }
  return normChild === normParent || normChild.startsWith(normParent.endsWith(path.sep) ? normParent : normParent + path.sep);
}

/** Resolve a workspace-relative or absolute path to a URI inside an open workspace folder. */
export function resolveWorkspaceUri(inputPath: string): { uri: vscode.Uri; relPath: string; folder: vscode.WorkspaceFolder } {
  const trimmed = inputPath.trim().replace(/\\/g, "/");
  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  const isAbs = path.isAbsolute(trimmed) || (process.platform === "win32" && /^[a-zA-Z]:/i.test(trimmed)) || /^\/[a-zA-Z]:/i.test(trimmed);
  if (isAbs) {
    const normalized = normalizeFsPath(trimmed);
    for (const folder of folders) {
      if (isSubpath(folder.uri.fsPath, normalized)) {
        const root = normalizeFsPath(folder.uri.fsPath);
        const rel = path.relative(root, normalized).split(path.sep).join("/");
        assertSafeRelativePath(rel);
        const relLabel = folders.length > 1 ? `${folder.name}/${rel}` : rel;
        return { uri: vscode.Uri.file(normalized), relPath: relLabel, folder };
      }
    }
    throw new Error("Path is outside all open workspace folders.");
  }

  const rel = trimmed.replace(/^[\\/]+/, "");
  assertSafeRelativePath(rel);

  if (folders.length === 1) {
    const root = normalizeFsPath(folders[0].uri.fsPath);
    const resolved = path.normalize(path.join(root, rel));
    if (!isSubpath(root, resolved)) {
      throw new Error("Refusing to access a path outside the workspace.");
    }
    return { uri: vscode.Uri.file(resolved), relPath: rel, folder: folders[0] };
  }

  // Multi-folder workspace: check if rel is "." or empty
  if (!rel || rel === ".") {
    const active = vscode.window.activeTextEditor;
    const preferred =
      active && folders.find((f) => isSubpath(f.uri.fsPath, active.document.uri.fsPath))
        ? folders.find((f) => isSubpath(f.uri.fsPath, active.document.uri.fsPath))!
        : folders[0];
    return { uri: preferred.uri, relPath: preferred.name, folder: preferred };
  }

  const firstSegment = rel.split("/")[0];
  const matched = folders.find((f) => f.name.toLowerCase() === firstSegment.toLowerCase());
  if (matched) {
    if (rel.includes("/")) {
      const rest = rel.slice(firstSegment.length + 1);
      assertSafeRelativePath(rest);
      const resolved = path.normalize(path.join(matched.uri.fsPath, rest));
      if (!isSubpath(matched.uri.fsPath, resolved)) {
        throw new Error("Refusing to access a path outside the workspace.");
      }
      return { uri: vscode.Uri.file(resolved), relPath: `${matched.name}/${rest}`, folder: matched };
    } else {
      return { uri: matched.uri, relPath: matched.name, folder: matched };
    }
  }

  const active = vscode.window.activeTextEditor;
  const preferred =
    active && folders.find((f) => isSubpath(f.uri.fsPath, active.document.uri.fsPath))
      ? folders.find((f) => isSubpath(f.uri.fsPath, active.document.uri.fsPath))!
      : folders[0];

  const resolved = path.normalize(path.join(preferred.uri.fsPath, rel));
  if (isSubpath(preferred.uri.fsPath, resolved)) {
    return { uri: vscode.Uri.file(resolved), relPath: `${preferred.name}/${rel}`, folder: preferred };
  }

  for (const folder of folders) {
    if (folder === preferred) continue;
    const r = path.normalize(path.join(folder.uri.fsPath, rel));
    if (isSubpath(folder.uri.fsPath, r)) {
      return { uri: vscode.Uri.file(r), relPath: `${folder.name}/${rel}`, folder };
    }
  }

  throw new Error("Refusing to access a path outside the workspace.");
}

function assertSafeRelativePath(rel: string): void {
  if (!rel || rel === ".") return;
  const segments = rel.split(/[/\\]/);
  if (segments.some((s) => s === "..")) {
    throw new Error("Path traversal (..) is not allowed.");
  }
}

export function normalizeWorkspaceRelativePath(inputPath?: string): string | undefined {
  if (!inputPath || typeof inputPath !== "string") return undefined;
  const trimmed = inputPath.trim();
  if (trimmed.length === 0 || trimmed === "." || trimmed === "./" || trimmed === "/") return undefined;

  const folders = getWorkspaceFolders();
  if (folders.length === 0) return undefined;

  const isAbs = path.isAbsolute(trimmed) || (process.platform === "win32" && /^[a-zA-Z]:/i.test(trimmed)) || /^\/[a-zA-Z]:/i.test(trimmed);
  if (isAbs) {
    const normalized = normalizeFsPath(trimmed);
    for (const folder of folders) {
      if (isSubpath(folder.uri.fsPath, normalized)) {
        const root = normalizeFsPath(folder.uri.fsPath);
        const rel = path.relative(root, normalized).split(path.sep).join("/").replace(/^[\\/]+/, "");
        return rel.length === 0 || rel === "." ? undefined : rel;
      }
    }
    throw new Error("Path is outside the current workspace.");
  }

  const rel = trimmed.replace(/\\/g, "/").replace(/^[\\/]+/, "");
  assertSafeRelativePath(rel);
  return rel.length === 0 || rel === "." ? undefined : rel;
}

export function buildWorkspaceGlob(pathInput: string | undefined, glob?: string): string {
  const prefix = pathInput
    ? pathInput.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/^\.$/, "")
    : "";
  const pattern = glob && glob.length > 0 ? glob.replace(/\\/g, "/").replace(/^\.\//, "") : "**/*";
  if (!prefix) return pattern;
  return `${prefix}/${pattern}`;
}

export function matchesDepth(relPath: string, basePath: string | undefined, depth?: number): boolean {
  if (depth === undefined || depth === null || depth < 0) return true;
  const baseDepth = basePath ? basePath.split("/").filter(Boolean).length : 0;
  const relDepth = relPath.split("/").filter(Boolean).length - baseDepth;
  return relDepth <= depth;
}

/** Simple gitignore / .cursorignore matcher (supports * and **). */
export class IgnoreMatcher {
  private patterns: string[] = [];

  static async forWorkspace(folder: vscode.WorkspaceFolder): Promise<IgnoreMatcher> {
    const m = new IgnoreMatcher();
    await m.loadFile(vscode.Uri.joinPath(folder.uri, ".gitignore"));
    await m.loadFile(vscode.Uri.joinPath(folder.uri, ".cursorignore"));
    return m;
  }

  private async loadFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf-8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        this.patterns.push(t.replace(/\\/g, "/"));
      }
    } catch {
      /* no ignore file */
    }
  }

  isIgnored(relPath: string): boolean {
    const p = relPath.replace(/\\/g, "/");
    for (const pattern of this.patterns) {
      if (matchIgnorePattern(pattern, p)) return true;
    }
    return false;
  }
}

function matchIgnorePattern(pattern: string, filePath: string): boolean {
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern.slice(0, -1)) || filePath.includes("/" + pattern.slice(0, -1));
  }
  const re = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$"
  );
  return re.test(filePath) || filePath.endsWith("/" + pattern);
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return true;
  return false;
}

export function getMaxFileBytes(): number {
  return vscode.workspace.getConfiguration("hooshyar").get<number>("maxFileSizeBytes", 10_485_760);
}

export async function readTextFile(uri: vscode.Uri, maxBytes?: number): Promise<string> {
  const limit = maxBytes !== undefined ? maxBytes : getMaxFileBytes();
  const stat = await vscode.workspace.fs.stat(uri);
  if (limit > 0 && isFinite(limit) && stat.size > limit) {
    throw new Error(`File exceeds max size (${stat.size} > ${limit} bytes). For large files, use 'read_file' with 'start_line' and 'end_line' to read specific sections.`);
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (isBinaryBuffer(Buffer.from(bytes))) {
    throw new Error("Refusing to read binary file as text.");
  }
  return Buffer.from(bytes).toString("utf-8");
}

export interface FileRangeResult {
  lines: string[];
  start: number;
  end: number;
  totalLines: number;
  isTruncated: boolean;
}

export async function readTextFileLineRange(
  uri: vscode.Uri,
  startLine?: number,
  endLine?: number,
  maxReturnLines: number = 1000
): Promise<FileRangeResult> {
  const hasRange = startLine !== undefined || endLine !== undefined;
  const reqStart = startLine !== undefined ? Math.max(1, Math.floor(startLine)) : 1;
  let reqEnd = endLine !== undefined ? Math.max(reqStart, Math.floor(endLine)) : undefined;

  let isTruncated = false;
  if (hasRange && reqEnd !== undefined) {
    const requestedCount = reqEnd - reqStart + 1;
    if (requestedCount > maxReturnLines) {
      reqEnd = reqStart + maxReturnLines - 1;
      isTruncated = true;
    }
  }

  // 1. Try fast streaming via fs if local file
  if (uri.scheme === "file" && uri.fsPath) {
    try {
      if (fs.existsSync(uri.fsPath)) {
        const stat = await fs.promises.stat(uri.fsPath);
        // Check binary on first 8KB
        const fd = await fs.promises.open(uri.fsPath, "r");
        try {
          const sample = Buffer.alloc(Math.min(8192, stat.size));
          if (sample.length > 0) {
            await fd.read(sample, 0, sample.length, 0);
            if (isBinaryBuffer(sample)) {
              throw new Error("Refusing to read binary file as text.");
            }
          }
        } finally {
          await fd.close();
        }

        const fileStream = fs.createReadStream(uri.fsPath, { encoding: "utf-8" });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        const selected: string[] = [];
        let currentLine = 0;
        const targetEnd = reqEnd ?? (hasRange ? reqStart + maxReturnLines - 1 : 350);

        for await (const line of rl) {
          currentLine++;
          if (currentLine >= reqStart && currentLine <= targetEnd) {
            selected.push(line);
          }
          // If file is very large (> 20MB) and we passed targetEnd, terminate stream early to save time
          if (stat.size > 20_000_000 && currentLine > targetEnd) {
            fileStream.destroy();
            break;
          }
        }

        const totalLines = currentLine;
        const actualEnd = reqEnd !== undefined
          ? Math.min(reqEnd, totalLines)
          : (hasRange ? Math.min(targetEnd, totalLines) : Math.min(350, totalLines));

        if (!hasRange && totalLines > 400) {
          isTruncated = true;
        }

        return {
          lines: selected,
          start: reqStart,
          end: actualEnd,
          totalLines,
          isTruncated
        };
      }
    } catch (err: unknown) {
      if ((err as Error)?.message?.includes("Refusing to read binary")) {
        throw err;
      }
      // If fs streaming failed for any reason (e.g. mock fs or permissions), fall through to vscode fs
    }
  }

  // 2. Fallback via vscode.workspace.fs (virtual filesystem, memory fs in tests, etc.)
  const bytes = await vscode.workspace.fs.readFile(uri);
  const buf = Buffer.from(bytes);
  if (isBinaryBuffer(buf)) {
    throw new Error("Refusing to read binary file as text.");
  }
  const text = buf.toString("utf-8");
  const allLines = text.split(/\r?\n/);
  const totalLines = allLines.length;

  if (hasRange) {
    const end = reqEnd !== undefined ? Math.min(reqEnd, totalLines) : Math.min(reqStart + maxReturnLines - 1, totalLines);
    if (reqStart > totalLines && totalLines > 0) {
      return { lines: [], start: reqStart, end, totalLines, isTruncated: false };
    }
    const selected = allLines.slice(reqStart - 1, end);
    return {
      lines: selected,
      start: reqStart,
      end,
      totalLines,
      isTruncated
    };
  }

  // No range specified
  const MAX_DEFAULT_LINES = 400;
  if (totalLines > MAX_DEFAULT_LINES) {
    const selected = allLines.slice(0, 350);
    return {
      lines: selected,
      start: 1,
      end: 350,
      totalLines,
      isTruncated: true
    };
  }

  return {
    lines: allLines,
    start: 1,
    end: totalLines,
    totalLines,
    isTruncated: false
  };
}

export function listAllWorkspaceRoots(): string {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) return "(no workspace)";
  return folders.map((f) => f.uri.fsPath).join("\n");
}
