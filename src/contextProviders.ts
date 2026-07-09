import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function getGitDiffContext(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (!cfg.get<boolean>("includeGitDiff", true)) return "";

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "";

  const parts: string[] = [];
  for (const folder of folders) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--stat", "HEAD"],
        { cwd: folder.uri.fsPath, timeout: 5000, maxBuffer: 256_000 }
      );
      if (!stdout.trim()) continue;
      parts.push(`[Git diff summary — ${folder.name}]\n${stdout.trim()}`);
    } catch {
      /* not a git repo or git unavailable */
    }
  }
  return parts.length > 0 ? parts.join("\n\n") + "\n\n" : "";
}

export async function getActiveFileSymbolsContext(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (!cfg.get<boolean>("includeSymbolOutline", true)) return "";

  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";

  const doc = editor.document;
  if (doc.uri.scheme !== "file") return "";

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    doc.uri
  );
  if (!symbols?.length) return "";

  const lines: string[] = [];
  const walk = (items: vscode.DocumentSymbol[], depth = 0) => {
    for (const s of items) {
      if (lines.length >= 40) return;
      lines.push(`${"  ".repeat(depth)}${s.name} (${vscode.SymbolKind[s.kind] ?? "symbol"})`);
      if (s.children?.length) walk(s.children, depth + 1);
    }
  };
  walk(symbols);

  const folders = vscode.workspace.workspaceFolders ?? [];
  let rel = doc.fileName;
  for (const folder of folders) {
    if (doc.uri.fsPath.startsWith(folder.uri.fsPath)) {
      rel = doc.uri.fsPath.slice(folder.uri.fsPath.length + 1).split("\\").join("/");
      if (folders.length > 1) rel = `${folder.name}/${rel}`;
      break;
    }
  }

  return `[Symbol outline: ${rel}]\n${lines.join("\n")}\n\n`;
}
