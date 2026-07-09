import * as vscode from "vscode";
import { readTextFile, resolveWorkspaceUri } from "./workspaceUtils";
import { getWorkspaceFileIndex } from "./workspaceIndex";
import { listWorkspaceRootsSummary } from "./tools";

const MENTION_RE = /@([\w./@-]+)/g;

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
  return text.replace(MENTION_RE, (_all, name: string) => `@${name}`);
}
