import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

const MAX_RULES_CHARS = 12_000;

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 100_000) return null;
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function collectRuleFiles(workspaceRoot: string, extraPaths: string[] = []): Promise<string[]> {
  const candidates = [
    path.join(workspaceRoot, ".cursorrules"),
    path.join(workspaceRoot, ".hooshyar", "rules.md"),
    path.join(workspaceRoot, ".hooshyarrules"),
    path.join(workspaceRoot, ".github", "copilot-instructions.md"),
    path.join(workspaceRoot, "AGENTS.md"),
    path.join(workspaceRoot, "CLAUDE.md"),
    ...extraPaths.map((p) => (path.isAbsolute(p) ? p : path.join(workspaceRoot, p)))
  ];

  const files: string[] = [];
  for (const file of candidates) {
    if (await readIfExists(file)) files.push(file);
  }

  const cursorRulesDir = path.join(workspaceRoot, ".cursor", "rules");
  try {
    const entries = await fs.readdir(cursorRulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(cursorRulesDir, entry.name));
      }
    }
  } catch {
    /* no rules dir */
  }

  return files;
}

export async function loadProjectRules(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "";

  const cfg = vscode.workspace.getConfiguration("hooshyar");
  const extraPaths = cfg.get<string[]>("rulesPaths", []);
  const parts: string[] = [];

  for (const folder of folders) {
    const files = await collectRuleFiles(folder.uri.fsPath, extraPaths);
    for (const file of files) {
      const content = await readIfExists(file);
      if (!content?.trim()) continue;
      const rel = path.relative(folder.uri.fsPath, file).split(path.sep).join("/");
      parts.push(`[Rules from ${folder.name}/${rel}]\n${content.trim()}`);
    }
  }

  let combined = parts.join("\n\n");
  if (combined.length > MAX_RULES_CHARS) {
    combined = combined.slice(0, MAX_RULES_CHARS) + "\n... (rules truncated)";
  }
  return combined;
}
