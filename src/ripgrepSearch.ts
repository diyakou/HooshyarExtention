import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { getWorkspaceFolders, getTargetWorkspaceFolder, normalizeWorkspaceRelativePath } from "./workspaceUtils";

const execFileAsync = promisify(execFile);

export interface RipgrepOptions {
  pattern: string;
  path?: string;
  glob?: string;
  isRegex?: boolean;
  maxMatches?: number;
}

export async function ripgrepSearch(options: RipgrepOptions): Promise<string | null> {
  const folders = getWorkspaceFolders();
  if (folders.length === 0) return null;

  const targetFolders = options.path ? [getTargetWorkspaceFolder(options.path)] : folders;
  const maxMatches = options.maxMatches ?? 200;
  const allLines: string[] = [];

  for (const folder of targetFolders) {
    if (allLines.length >= maxMatches) break;
    const root = folder.uri.fsPath;
    const normalizedPath = normalizeWorkspaceRelativePath(options.path);
    const searchRoot = normalizedPath ? path.join(root, normalizedPath) : root;

    const remainingMatches = maxMatches - allLines.length;
    const args: string[] = [
      "--no-heading",
      "--line-number",
      "--color=never",
      "--max-count",
      String(remainingMatches),
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.git/**"
    ];

    if (!options.isRegex) args.push("--fixed-strings");
    if (options.glob) args.push("--glob", options.glob);
    args.push(options.pattern, searchRoot);

    try {
      const { stdout } = await execFileAsync("rg", args, {
        cwd: root,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      });

      const lines = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const rel = line.replace(root + path.sep, "").replace(root + "/", "").split(path.sep).join("/");
          return folders.length > 1 ? `${folder.name}/${rel}` : rel;
        });

      allLines.push(...lines);
    } catch (err: any) {
      if (err?.code === 1) continue; // No matches in this folder
      return null; // rg binary not available or failed
    }
  }

  if (allLines.length === 0) return "No matches found.";
  const suffix = allLines.length >= maxMatches ? `\n... (capped at ${maxMatches} matches)` : "";
  return allLines.join("\n") + suffix;
}
