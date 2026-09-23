import * as vscode from "vscode";
import * as path from "path";
import { DEFAULT_EXCLUDE_GLOB, isSubpath, normalizeFsPath } from "./workspaceUtils";

export interface IndexedFile {
  path: string;
  label: string;
}

let cachedFiles: IndexedFile[] = [];
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export async function getWorkspaceFileIndex(force = false): Promise<IndexedFile[]> {
  if (!force && Date.now() - cachedAt < CACHE_TTL_MS && cachedFiles.length > 0) {
    return cachedFiles;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    cachedFiles = [];
    cachedAt = Date.now();
    return cachedFiles;
  }

  const cap = vscode.workspace.getConfiguration("hooshyar").get<number>("workspaceIndexMaxFiles", 2000);
  const uris = await vscode.workspace.findFiles("**/*", DEFAULT_EXCLUDE_GLOB, cap);
  const files: IndexedFile[] = [];

  for (const uri of uris) {
    for (const folder of folders) {
      if (!isSubpath(folder.uri.fsPath, uri.fsPath)) continue;
      const root = normalizeFsPath(folder.uri.fsPath);
      const rel = path.relative(root, normalizeFsPath(uri.fsPath)).split(path.sep).join("/");
      const p = folders.length > 1 ? `${folder.name}/${rel}` : rel;
      files.push({ path: p, label: p });
      break;
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  cachedFiles = files;
  cachedAt = Date.now();
  return files;
}

export function searchFileIndex(query: string, limit = 12): IndexedFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return cachedFiles.slice(0, limit);

  const scored = cachedFiles
    .map((f) => {
      const p = f.path.toLowerCase();
      let score = 0;
      if (p === q) score = 100;
      else if (p.endsWith(q)) score = 80;
      else if (p.includes("/" + q)) score = 70;
      else if (p.includes(q)) score = 50;
      else if (p.split("/").pop()?.startsWith(q)) score = 60;
      return { f, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));

  return scored.slice(0, limit).map((x) => x.f);
}

export function invalidateWorkspaceIndex(): void {
  cachedAt = 0;
  cachedFiles = [];
}
