import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { normalizeWorkspaceRelativePath, requireWorkspaceFolder } from "./workspaceUtils";

const execFileAsync = promisify(execFile);

export interface RipgrepOptions {
  pattern: string;
  path?: string;
  glob?: string;
  isRegex?: boolean;
  maxMatches?: number;
}

export async function ripgrepSearch(options: RipgrepOptions): Promise<string | null> {
  const folder = requireWorkspaceFolder();
  const root = folder.uri.fsPath;
  const normalizedPath = normalizeWorkspaceRelativePath(options.path);
  const searchRoot = normalizedPath ? path.join(root, normalizedPath) : root;
  const maxMatches = options.maxMatches ?? 200;

  const args: string[] = [
    "--no-heading",
    "--line-number",
    "--color=never",
    "--max-count",
    String(maxMatches),
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
      .map((line) => line.replace(root + path.sep, "").replace(root + "/", "").split(path.sep).join("/"));

    if (lines.length === 0) return "No matches found.";
    const suffix = lines.length >= maxMatches ? `\n... (capped at ${maxMatches} matches)` : "";
    return lines.join("\n") + suffix;
  } catch (err: any) {
    if (err?.code === 1) return "No matches found.";
    return null;
  }
}
