import * as vscode from "vscode";
import * as path from "path";
import { AttachedFile } from "./types";
import { listWorkspaceRootsSummary } from "./tools";
import { getActiveFileSymbolsContext, getGitDiffContext } from "./contextProviders";
import { loadProjectRules } from "./rulesLoader";
import { resolveMentionsToContext } from "./mentionResolver";
import { resolveWorkspaceUri } from "./workspaceUtils";

export async function buildContextPrefix(
  pendingAttachments: AttachedFile[],
  clearAttachments: () => void
): Promise<string> {
  const parts: string[] = [];
  const cfg = vscode.workspace.getConfiguration("hooshyar");

  if (cfg.get<boolean>("autoIncludeActiveFile", true)) {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders;
    if (editor && folders && folders.length > 0) {
      const filePath = editor.document.uri.fsPath;
      for (const folder of folders) {
        const root = folder.uri.fsPath;
        if (!filePath.startsWith(root)) continue;
        const relPath = path.relative(root, filePath).split(path.sep).join("/");
        const prefix = folders.length > 1 ? `${folder.name}/${relPath}` : relPath;
        const selection = editor.selection;
        if (!selection.isEmpty) {
          const selectedText = editor.document.getText(selection);
          parts.push(
            `[Active file: ${prefix}, selected lines ${selection.start.line + 1}-${selection.end.line + 1}]\n` +
              "```\n" + selectedText + "\n```"
          );
        } else {
          const fullText = editor.document.getText();
          if (fullText.length < 20_000) {
            parts.push(`[Active file: ${prefix}]\n` + "```\n" + fullText + "\n```");
          } else {
            parts.push(`[Active file: ${prefix} - too large to auto-include, use read_file if needed]`);
          }
        }
        break;
      }
    }
  }

  for (const file of pendingAttachments) {
    parts.push(`[Attached file: ${file.path}]\n` + "```\n" + file.content + "\n```");
  }
  clearAttachments();

  const symbols = await getActiveFileSymbolsContext();
  if (symbols) parts.push(symbols.trimEnd());

  const gitDiff = await getGitDiffContext();
  if (gitDiff) parts.push(gitDiff.trimEnd());

  return parts.length > 0 ? parts.join("\n\n") + "\n\n---\n\n" : "";
}

export async function buildEnvironmentDetails(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return "[environment_details]\nNo workspace folder is currently open in VS Code.\n[/environment_details]";
  }
  const cap = 300;
  const rootsSummary = listWorkspaceRootsSummary();
  let fileList = "";
  try {
    const exclude =
      "**/{node_modules,out,dist,build,.git,.venv,venv,__pycache__,.next,.turbo,coverage}/**";
    const uris = await vscode.workspace.findFiles("**/*", exclude, cap);
    const rels: string[] = [];
    for (const u of uris) {
      for (const folder of folders) {
        const root = folder.uri.fsPath;
        if (u.fsPath.startsWith(root)) {
          const rel = path.relative(root, u.fsPath).split(path.sep).join("/");
          rels.push(folders.length > 1 ? `${folder.name}/${rel}` : rel);
          break;
        }
      }
    }
    rels.sort();
    fileList = rels.join("\n");
    if (uris.length >= cap) {
      fileList += `\n... (list truncated at ${cap}; use list_codebase for more)`;
    }
  } catch {
    /* ignore */
  }

  const openTabs: string[] = [];
  for (const e of vscode.window.visibleTextEditors) {
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      if (e.document.uri.fsPath.startsWith(root)) {
        const rel = path.relative(root, e.document.uri.fsPath).split(path.sep).join("/");
        openTabs.push(folders.length > 1 ? `${folder.name}/${rel}` : rel);
        break;
      }
    }
  }

  return (
    "[environment_details]\n" +
    `Workspace folder(s):\n${rootsSummary}\n` +
    (openTabs.length > 0 ? `Open editor tabs: ${openTabs.join(", ")}\n` : "") +
    "\nFiles in workspace (relative paths):\n" +
    (fileList || "(no files found)") +
    "\n[/environment_details]"
  );
}

export async function buildSystemPrompt(basePrompt: string): Promise<string> {
  const rules = await loadProjectRules();
  if (!rules.trim()) return basePrompt;
  return `${basePrompt}\n\n## PROJECT RULES\n${rules}`;
}

export async function buildUserMessagePrefix(text: string, isFirstMessage: boolean): Promise<string> {
  const mentionContext = await resolveMentionsToContext(text);
  let prefix = mentionContext;

  if (isFirstMessage) {
    const env = await buildEnvironmentDetails();
    prefix = env + "\n\n---\n\n" + prefix;
  }

  return prefix;
}

export function getLastUserMessageText(history: { role: string; content: unknown }[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "user") continue;

    let t = "";
    if (typeof m.content === "string") {
      t = m.content;
    } else if (Array.isArray(m.content)) {
      const hasToolOnly = m.content.every((b) => b.type === "tool_result");
      if (hasToolOnly) continue;
      t = m.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } else {
      continue;
    }

    const marker = "---\n\n";
    const idx = t.lastIndexOf(marker);
    if (idx >= 0) t = t.slice(idx + marker.length);
    const trimmed = t.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export async function openWrittenFile(relPath: string): Promise<void> {
  try {
    const { uri } = resolveWorkspaceUri(relPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch {
    /* ignore */
  }
}
