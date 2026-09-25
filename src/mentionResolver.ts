import * as vscode from "vscode";
import { readTextFile, resolveWorkspaceUri } from "./workspaceUtils";
import { getWorkspaceFileIndex } from "./workspaceIndex";
import { listWorkspaceRootsSummary } from "./tools";
import { getGitDiff } from "./gitCommitGenerator";

const MENTION_RE = /(?:@|#)([\w./@:-]+)/g;

export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

export async function resolveMentionsToContext(text: string): Promise<string> {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return "";

  const parts: string[] = [];

  for (const mention of mentions) {
    if (mention === "workspace") {
      parts.push(`[@workspace]\n${listWorkspaceRootsSummary()}`);
      continue;
    }

    if (mention === "selection") {
      const editor = vscode.window.activeTextEditor;
      if (editor && !editor.selection.isEmpty) {
        const selected = editor.document.getText(editor.selection);
        parts.push(`[@selection]\n\`\`\`\n${selected}\n\`\`\``);
      }
      continue;
    }

    if (mention === "editor" || mention === "file") {
      const editor = vscode.window.activeTextEditor;
      if (editor) parts.push(`[${mention}]\nFile: ${vscode.workspace.asRelativePath(editor.document.uri, false)}\n\`\`\`\n${editor.document.getText().slice(0, 20_000)}\n\`\`\``);
      continue;
    }

    if (mention === "problems") {
      const diagnostics = vscode.languages.getDiagnostics().flatMap(([uri, items]) => items.map((item) =>
        `${vscode.workspace.asRelativePath(uri, false)}:${item.range.start.line + 1} ${item.message}`));
      parts.push(`[#problems]\n${diagnostics.slice(0, 100).join("\n") || "No workspace diagnostics."}`);
      continue;
    }

    if (mention === "git") {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) parts.push(`[#git]\n${(await getGitDiff(root, false)).slice(0, 20_000) || "No working tree changes."}`);
      continue;
    }

    if (mention === "codebase" || mention === "tests") {
      const index = await getWorkspaceFileIndex();
      const files = mention === "tests" ? index.filter((file) => /(?:test|spec)/i.test(file.path)) : index;
      parts.push(`[#${mention}]\n${files.slice(0, 200).map((file) => file.path).join("\n") || "No matching files."}`);
      continue;
    }

    const normalized = mention.replace(/^@/, "");
    try {
      const { uri } = resolveWorkspaceUri(normalized);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        const index = await getWorkspaceFileIndex();
        const children = index.filter((f) => f.path.startsWith(normalized + "/")).slice(0, 40);
        parts.push(
          `[@${normalized}/]\n` +
            (children.length > 0 ? children.map((c) => c.path).join("\n") : "(empty folder)")
        );
      } else {
        const content = await readTextFile(uri);
        const clipped =
          content.length > 20_000 ? content.slice(0, 20_000) + "\n... (truncated)" : content;
        parts.push(`[@${normalized}]\n\`\`\`\n${clipped}\n\`\`\``);
      }
    } catch {
      /* unknown mention — skip */
    }
  }

  return parts.length > 0 ? parts.join("\n\n") + "\n\n---\n\n" : "";
}

export function stripMentionMarkers(text: string): string {
  return text.replace(MENTION_RE, (all: string, name: string) => `${all[0]}${name}`);
}
