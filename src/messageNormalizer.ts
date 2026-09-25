import * as vscode from "vscode";
import * as path from "path";
import { AttachedFile } from "./types";
import { listWorkspaceRootsSummary } from "./tools";
import { getActiveFileSymbolsContext, getGitDiffContext } from "./contextProviders";
import { loadProjectRules } from "./rulesLoader";
import { resolveMentionsToContext } from "./mentionResolver";
import {
  buildHostCommandGuidance,
  isSubpath,
  normalizeFsPath,
  readTextFile,
  resolveWorkspaceUri,
  getEnvironmentPlatformInfo
} from "./workspaceUtils";
import { MemoryManager } from "./memoryManager";
import { loadSkills } from "./skillsManager";

export const USER_REQUEST_MARKER = "[hooshyar_user_request]";

export async function buildContextPrefix(
  pendingAttachments: AttachedFile[],
  clearAttachments: () => void,
  isFirstMessage: boolean = true
): Promise<string> {
  const parts: string[] = [];
  const cfg = vscode.workspace?.getConfiguration ? vscode.workspace.getConfiguration("hooshyar") : undefined;

  if (cfg ? cfg.get<boolean>("autoIncludeActiveFile", true) : true) {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders;
    if (editor && folders && folders.length > 0) {
      const filePath = editor.document.uri.fsPath;
      for (const folder of folders) {
        if (!isSubpath(folder.uri.fsPath, filePath)) continue;
        const root = normalizeFsPath(folder.uri.fsPath);
        const relPath = path.relative(root, normalizeFsPath(filePath)).split(path.sep).join("/");
        const prefix = folders.length > 1 ? `${folder.name}/${relPath}` : relPath;
        const selection = editor.selection;
        if (!selection.isEmpty) {
          const selectedText = editor.document.getText(selection);
          parts.push(
            `[Active file: ${prefix}, selected lines ${selection.start.line + 1}-${selection.end.line + 1}]\n` +
              "```\n" + selectedText + "\n```"
          );
        } else if (isFirstMessage) {
          // Only auto-include entire file on the initial turn to save tokens
          const fullText = editor.document.getText();
          if (fullText.length < 8_000) {
            parts.push(`[Active file: ${prefix}]\n` + "```\n" + fullText + "\n```");
          } else {
            parts.push(`[Active file: ${prefix} (${editor.document.lineCount} lines) - use read_file for full content if needed]`);
          }
        } else {
          // On follow-up messages, just provide a lightweight reference without repeating thousands of chars
          parts.push(`[Active editor file: ${prefix}]`);
        }
        break;
      }
    }
  }

  for (const file of pendingAttachments) {
    parts.push(`[Attached file: ${file.path}]\n` + "```\n" + file.content + "\n```");
  }
  clearAttachments();

  // Only auto-include full symbol outlines and git diff on the first message
  if (isFirstMessage) {
    const symbols = await getActiveFileSymbolsContext();
    if (symbols) parts.push(symbols.trimEnd());

    const gitDiff = await getGitDiffContext();
    if (gitDiff) parts.push(gitDiff.trimEnd());
  }

  return parts.length > 0 ? parts.join("\n\n") + "\n\n---\n\n" : "";
}

export async function buildEnvironmentDetails(): Promise<string> {
  const envInfo = getEnvironmentPlatformInfo();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return (
      "[environment_details]\n" +
      `Operating System: ${envInfo.os} (${envInfo.platform})\n` +
      `Terminal Shell: ${envInfo.shell} (${envInfo.shellPath})\n` +
      "No workspace folder is currently open in VS Code.\n" +
      "[/environment_details]"
    );
  }
  const cap = 300;

  const folderSummaries: string[] = [];
  for (const folder of folders) {
    let subDirs: string[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder.uri);
      subDirs = entries
        .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith(".") && name !== "node_modules" && name !== "out" && name !== "dist")
        .map(([name]) => name + "/");
    } catch {
      /* ignore */
    }
    const dirList = subDirs.length > 0 ? ` [subdirectories: ${subDirs.join(", ")}]` : "";
    folderSummaries.push(`- ${folder.name}: ${folder.uri.fsPath}${dirList}`);
  }

  let fileList = "";
  try {
    const exclude =
      "**/{node_modules,out,dist,build,.git,.venv,venv,__pycache__,.next,.turbo,coverage}/**";
    const uris = await vscode.workspace.findFiles("**/*", exclude, cap);
    const rels: string[] = [];
    for (const u of uris) {
      for (const folder of folders) {
        if (isSubpath(folder.uri.fsPath, u.fsPath)) {
          const root = normalizeFsPath(folder.uri.fsPath);
          const rel = path.relative(root, normalizeFsPath(u.fsPath)).split(path.sep).join("/");
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
      if (isSubpath(folder.uri.fsPath, e.document.uri.fsPath)) {
        const root = normalizeFsPath(folder.uri.fsPath);
        const rel = path.relative(root, normalizeFsPath(e.document.uri.fsPath)).split(path.sep).join("/");
        openTabs.push(folders.length > 1 ? `${folder.name}/${rel}` : rel);
        break;
      }
    }
  }

  return (
    "[environment_details]\n" +
    `Operating System: ${envInfo.os} (${envInfo.platform})\n` +
    `Terminal Shell: ${envInfo.shell} (${envInfo.shellPath})\n` +
    `Open Project Folder(s):\n${folderSummaries.join("\n")}\n` +
    (openTabs.length > 0 ? `Open editor tabs: ${openTabs.join(", ")}\n` : "") +
    "\nFiles in project (relative paths):\n" +
    (fileList || "(no files found)") +
    "\n[/environment_details]"
  );
}

export const CHAT_SYSTEM_PROMPT_BASE =
  "You are Hooshyar (هوشیار), an expert AI coding assistant and technical advisor running inside VS Code.\n\n" +
  "## CHAT MODE (PURE CONVERSATION — NO FILE MODIFICATIONS)\n" +
  "You are currently operating in CHAT MODE. In this mode:\n" +
  "- You answer questions, explain concepts, review code, brainstorm architecture, debug issues, and chat with the user.\n" +
  "- You DO NOT modify any files on the filesystem, DO NOT create new files on disk, and DO NOT run terminal commands.\n" +
  "- Tools are disabled in Chat Mode. NEVER emit tool calls or XML tags such as <tool_call>, <write_file>, <search_replace>, or <function>.\n" +
  "- When suggesting code or fixes, provide clean, complete, and well-commented code snippets directly inside markdown code blocks (e.g. ```typescript, ```python), explaining the rationale and how the user can apply them.\n" +
  "- If the user specifically asks you to directly apply edits to their files on disk, explain that you are in Chat Mode, show the code here in the conversation, and let them know they can switch to 'Agent Mode' (حالت اجنت) using the mode toggle button at the top to let Hooshyar apply edits automatically.\n" +
  "- Always respond helpfully, politely, and clearly in Persian (or the user's language).";

export async function buildSystemPrompt(basePrompt: string): Promise<string> {
  const envInfo = getEnvironmentPlatformInfo();
  const rootsSummary = listWorkspaceRootsSummary();
  const folders = vscode.workspace.workspaceFolders || [];

  const multiFolderNotice = folders.length > 1
    ? "\n\n## MULTI-PROJECT WORKSPACE\n" +
      `There are ${folders.length} open project folders in this workspace:\n` +
      folders.map((f) => `- ${f.name} (${f.uri.fsPath})`).join("\n") +
      "\nWhen using tools (read_file, write_file, search_replace, list_codebase, etc.), prefix relative paths with the project folder name (e.g. `FolderName/path/to/file`) to target that specific project."
    : "";

  const osTerminalSection =
    "\n\n## HOST ENVIRONMENT & TERMINAL COMMAND RULES (STRICT)\n" +
    `- Operating System: ${envInfo.os} (${envInfo.platform})\n` +
    `- Active Shell: ${envInfo.shell} (${envInfo.shellPath})\n` +
    `- ${buildHostCommandGuidance(envInfo)}\n` +
    (envInfo.isWindows
      ? "- CRITICAL WINDOWS COMMAND RULES: NEVER generate Linux-only commands such as `ls -la`, `cat`, `grep`, `rm -rf`, `export VAR=val`, `source venv/bin/activate`, `touch`, or `chmod`. Do not mix PowerShell and CMD syntax.\n" +
        "- CRITICAL TOOL USAGE: NEVER use shell commands (`cat`, `type`, `Get-Content`, `head`, `tail`) to read file contents! ALWAYS use the dedicated `read_file` tool to inspect files.\n" +
        "- Before emitting run_command or run_in_terminal, verify every command against the Active Shell above."
      : "- CRITICAL TOOL USAGE: NEVER use shell commands (`cat`, `head`, `tail`) to read file contents! ALWAYS use the dedicated `read_file` tool to inspect files.\n" +
        "- Before emitting run_command or run_in_terminal, verify every command uses the Active Shell syntax above.");

  const workspaceInfo = `\n\n## CURRENT WORKSPACE\ncurrent working directory is: ${rootsSummary}\nActive workspace folder(s):\n${rootsSummary}${multiFolderNotice}`;
  const [rules, skills] = await Promise.all([loadProjectRules(), loadSkills()]);
  const rulesText = rules.trim() ? `\n\n## PROJECT RULES\n${rules}` : "";
  const skillsText = skills.trim()
    ? "\n\n## AVAILABLE SKILLS\n" +
      "Apply a skill only when the request clearly matches its domain. Skills provide reusable expertise and are independent from MCP tools; " +
      "use relevant skills and MCP tools together when the task needs both. Skill examples are guidance, not pending user requests.\n\n" + skills
    : "";
  const memoryText = MemoryManager.getInstance().formatForSystemPrompt();
  const memorySection = memoryText.trim() ? `\n\n${memoryText.trim()}` : "";
  const planningInstructions = basePrompt.includes("AGENT MODE")
    ? "\n\n## PERSISTENT PLANNING & AUTONOMOUS EXECUTION\n" +
      "For multi-step implementation requests, start by calling update_tasks with a numbered checklist (3-5 steps). " +
      "Before making implementation edits, create a concise persistent plan at `.hooshyar/PLAN.md` using write_file when it does not exist. " +
      "Keep it updated as work progresses (use search_replace to mark completed steps [x]). " +
      "CRITICAL: Once you start executing a plan, DO NOT stop after step 1! Execute each step sequentially using your tools until ALL tasks in your task list are marked completed. " +
      "Do NOT stop or ask for user confirmation between routine steps of your plan. Read `.hooshyar/PLAN.md` before acting on new requests so unfinished work is continued."
    : "";
  return `${basePrompt}${workspaceInfo}${osTerminalSection}${rulesText}${skillsText}${memorySection}${planningInstructions}`;
}

async function buildInitialMarkdownContext(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "";

  // Markdown files often contain project instructions, architecture notes, or an existing plan.
  // Provide a bounded snapshot on the first turn, so the agent can read them before acting.
  const exclude = "**/{node_modules,out,dist,build,.git,.venv,venv,__pycache__,.next,.turbo,coverage,.hooshyar}/**";
  const uris = await vscode.workspace.findFiles("**/*.md", exclude, 20);
  const parts: string[] = [];
  let remaining = 24_000;
  for (const uri of uris.sort((a, b) => a.path.localeCompare(b.path))) {
    if (remaining <= 0) break;
    try {
      const text = await readTextFile(uri, Math.min(remaining, 100_000));
      if (!text.trim()) continue;
      const folder = folders.find((f) => isSubpath(f.uri.fsPath, uri.fsPath));
      if (!folder) continue;
      const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
      const label = folders.length > 1 ? `${folder.name}/${rel}` : rel;
      const content = text.slice(0, remaining);
      parts.push(`[Markdown file: ${label}]\n\`\`\`md\n${content}\n\`\`\``);
      remaining -= content.length;
    } catch {
      // An unreadable or oversized Markdown file must not prevent sending the user's request.
    }
  }
  if (!parts.length) return "";
  return `[Initial Markdown context — read before responding]\n\n${parts.join("\n\n")}`;
}

export async function buildUserMessagePrefix(text: string, isFirstMessage: boolean): Promise<string> {
  const mentionContext = await resolveMentionsToContext(text);
  let prefix = mentionContext;

  if (isFirstMessage) {
    const [env, markdown] = await Promise.all([buildEnvironmentDetails(), buildInitialMarkdownContext()]);
    prefix = [env, markdown, prefix].filter(Boolean).join("\n\n---\n\n");
  } else if (/(?:پروژه|ورک\s*اسپیس|فولدر|پوشه|فایل|project|workspace|codebase)/i.test(text)) {
    const roots = listWorkspaceRootsSummary();
    prefix = `[workspace_folder: ${roots}]\n\n` + prefix;
  }

  return prefix;
}

export function composeUserMessage(contextParts: string[], text: string): string {
  const prefix = contextParts
    .map((part) => part.trim().replace(/(?:\r?\n)?---\s*$/, "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");

  return prefix ? `${prefix}\n\n${USER_REQUEST_MARKER}\n${text}` : text;
}

export function getDisplayUserMessageText(raw: string): string {
  const taggedIndex = raw.lastIndexOf(USER_REQUEST_MARKER);
  if (taggedIndex >= 0) {
    return raw.slice(taggedIndex + USER_REQUEST_MARKER.length).trim();
  }

  // Backwards compatibility for sessions saved before user requests had an explicit marker.
  if (/\[(?:environment_details|Initial Markdown context|Markdown file:|Active file:)/i.test(raw)) {
    const environmentEnd = raw.lastIndexOf("[/environment_details]");
    const fenceEnd = raw.lastIndexOf("```");
    const contextEnd = Math.max(
      environmentEnd >= 0 ? environmentEnd + "[/environment_details]".length : -1,
      fenceEnd >= 0 ? fenceEnd + 3 : -1
    );
    const trailingText = contextEnd >= 0 ? raw.slice(contextEnd).trim() : "";
    if (trailingText) return trailingText;
  }

  const legacyParts = raw.split(/\r?\n---\r?\n\r?\n/);
  return (legacyParts.length > 1 ? legacyParts[legacyParts.length - 1] : raw).trim();
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

    const trimmed = getDisplayUserMessageText(t);
    if (trimmed) return trimmed;
  }
  return "";
}

export async function openWrittenFile(relPath: string): Promise<void> {
  try {
    const { uri } = resolveWorkspaceUri(relPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
  } catch {
    /* ignore */
  }
}
