import * as vscode from "vscode";
import * as path from "path";

export const DEFAULT_EXCLUDE_GLOB =
  "**/{node_modules,out,dist,build,.git,.venv,venv,__pycache__,.next,.turbo,coverage}/**";

export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  return vscode.workspace.workspaceFolders ?? [];
}

export function requireWorkspaceFolder(): vscode.WorkspaceFolder {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }
  return folders[0];
}

/** Resolve a workspace-relative or absolute path to a URI inside an open workspace folder. */
export function resolveWorkspaceUri(inputPath: string): { uri: vscode.Uri; relPath: string; folder: vscode.WorkspaceFolder } {
  const trimmed = inputPath.trim().replace(/\\/g, "/");
  const folders = getWorkspaceFolders();
  if (folders.length === 0) {
    throw new Error("No workspace folder is open.");
  }

  if (path.isAbsolute(trimmed)) {
    const normalized = path.normalize(trimmed);
    for (const folder of folders) {
      const root = path.normalize(folder.uri.fsPath);
      if (normalized === root || normalized.startsWith(root + path.sep)) {
        const rel = path.relative(root, normalized).split(path.sep).join("/");
        assertSafeRelativePath(rel);
        return { uri: vscode.Uri.file(normalized), relPath: rel, folder };
      }
    }
    throw new Error("Path is outside all open workspace folders.");
  }

  const rel = trimmed.replace(/^[\\/]+/, "");
  assertSafeRelativePath(rel);

  if (folders.length === 1) {
    const root = folders[0].uri.fsPath;
    const resolved = path.normalize(path.join(root, rel));
    if (!resolved.startsWith(path.normalize(root))) {
      throw new Error("Refusing to access a path outside the workspace.");
    }
    return { uri: vscode.Uri.file(resolved), relPath: rel, folder: folders[0] };
  }

  const firstSegment = rel.split("/")[0];
  const matched = folders.find((f) => f.name === firstSegment);
  if (matched && rel.includes("/")) {
    const rest = rel.slice(firstSegment.length + 1);
    const resolved = path.normalize(path.join(matched.uri.fsPath, rest));
    assertSafeRelativePath(rest);
    return { uri: vscode.Uri.file(resolved), relPath: `${matched.name}/${rest}`, folder: matched };
  }

  const active = vscode.window.activeTextEditor;
  const preferred =
    active && folders.find((f) => active.document.uri.fsPath.startsWith(f.uri.fsPath))
      ? folders.find((f) => active.document.uri.fsPath.startsWith(f.uri.fsPath))!
      : folders[0];

  const resolved = path.normalize(path.join(preferred.uri.fsPath, rel));
  if (!resolved.startsWith(path.normalize(preferred.uri.fsPath))) {
    throw new Error("Refusing to access a path outside the workspace.");
  }
  return { uri: vscode.Uri.file(resolved), relPath: rel, folder: preferred };
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

  const normalized = path.normalize(trimmed.replace(/\\/g, "/"));
  if (path.isAbsolute(normalized)) {
    for (const folder of folders) {
      const root = path.normalize(folder.uri.fsPath);
      if (normalized.startsWith(root)) {
        const rel = path.relative(root, normalized).replace(/^[\\/]+/, "");
        return rel.length === 0 || rel === "." ? undefined : rel;
      }
    }
    throw new Error("Path is outside the current workspace.");
  }

  const rel = normalized.replace(/^[\\/]+/, "");
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
  return vscode.workspace.getConfiguration("hooshyar").get<number>("maxFileSizeBytes", 2_000_000);
}

export async function readTextFile(uri: vscode.Uri, maxBytes?: number): Promise<string> {
  const limit = maxBytes ?? getMaxFileBytes();
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > limit) {
    throw new Error(`File exceeds max size (${stat.size} > ${limit} bytes).`);
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  if (isBinaryBuffer(Buffer.from(bytes))) {
    throw new Error("Refusing to read binary file as text.");
  }
  return Buffer.from(bytes).toString("utf-8");
}

export function listAllWorkspaceRoots(): string {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) return "(no workspace)";
  return folders.map((f) => f.uri.fsPath).join("\n");
}
