import * as vscode from "vscode";
import { exec } from "child_process";
import { ApiClient } from "./apiClient";
import { ApiClientConfig } from "./apiConfig";
import { logInfo, logError } from "./logger";

export async function getGitDiff(workspaceRoot: string, stagedOnly: boolean = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = stagedOnly ? "git diff --cached" : "git diff";
    exec(cmd, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 2 }, (err, stdout) => {
      if (err) {
        // If staged returned error or nothing, try regular diff
        if (stagedOnly) {
          exec("git diff", { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 2 }, (err2, stdout2) => {
            if (err2) return resolve("");
            resolve(stdout2 || "");
          });
        } else {
          resolve("");
        }
      } else {
        resolve(stdout || "");
      }
    });
  });
}

export function buildCommitPrompt(diff: string): string {
  return (
    "You are an expert Git assistant. Generate a clear, concise Conventional Commit message based strictly on the following git diff.\n" +
    "Format:\n" +
    "<type>(<optional scope>): <short description in imperative mood, <= 72 chars>\n\n" +
    "[optional body with bullet points if multiple changes]\n\n" +
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore.\n" +
    "Return ONLY the raw commit message text, with no markdown code blocks, backticks, or conversational preamble.\n\n" +
    `GIT DIFF:\n${diff.slice(0, 8000)}`
  );
}

export async function generateCommitMessage(
  getConfig: () => ApiClientConfig
): Promise<string | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("Hooshyar: No workspace open to inspect Git status.");
    return null;
  }

  const activeEditor = vscode.window.activeTextEditor;
  const activeFolder = activeEditor
    ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
    : undefined;

  let folder = activeFolder;
  if (!folder && folders.length === 1) {
    folder = folders[0];
  }
  if (!folder) {
    const selected = await vscode.window.showQuickPick(
      folders.map((workspaceFolder) => ({
        label: workspaceFolder.name,
        description: workspaceFolder.uri.fsPath,
        folder: workspaceFolder
      })),
      {
        title: "Hooshyar: Select the Git repository",
        placeHolder: "Choose the workspace folder whose changes should be summarized"
      }
    );
    if (!selected) return null;
    folder = selected.folder;
  }

  const root = folder.uri.fsPath;
  let diff = await getGitDiff(root, true);
  if (!diff || !diff.trim()) {
    diff = await getGitDiff(root, false);
  }

  if (!diff || !diff.trim()) {
    vscode.window.showInformationMessage("Hooshyar: No Git changes detected (both staged and unstaged diffs are empty).");
    return null;
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Hooshyar: Generating Git commit message...",
      cancellable: true
    },
    async (progress, token) => {
      const client = new ApiClient(getConfig);
      let generatedText = "";

      const abortCtrl = new AbortController();
      token.onCancellationRequested(() => abortCtrl.abort());

      try {
        await client.send(
          {
            messages: [
              {
                role: "user",
                content: buildCommitPrompt(diff)
              }
            ]
          },
          {
            onTextDelta: (t) => {
              generatedText += t;
            },
            onToolUseStart: () => {},
            onToolUseInputDelta: () => {},
            onToolUseStop: () => {},
            onDone: () => {},
            onError: (err) => {
              logError(`Commit generator error: ${err}`);
            }
          },
          abortCtrl.signal
        );

        let cleanMsg = generatedText.trim();
        // Strip markdown code fences if model returned them
        if (cleanMsg.startsWith("```") && cleanMsg.endsWith("```")) {
          cleanMsg = cleanMsg.replace(/^```[a-z]*\r?\n/, "").replace(/\r?\n```$/, "").trim();
        }

        if (!cleanMsg) {
          vscode.window.showWarningMessage("Hooshyar: Could not generate a commit message.");
          return null;
        }

        // Try to inject into VS Code Git Source Control input box
        let injected = false;
        try {
          const gitExt = vscode.extensions.getExtension("vscode.git");
          if (gitExt) {
            const gitApi = gitExt.exports.getAPI(1);
            if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
              const repo = gitApi.repositories[0];
              repo.inputBox.value = cleanMsg;
              injected = true;
            }
          }
        } catch (err) {
          logInfo(`Could not set git repository inputBox: ${err}`);
        }

        if (injected) {
          vscode.window.showInformationMessage(`Hooshyar: Commit message set in Source Control.`);
        } else {
          await vscode.env.clipboard.writeText(cleanMsg);
          vscode.window.showInformationMessage(`Hooshyar: Commit message copied to clipboard:\n"${cleanMsg}"`);
        }

        return cleanMsg;
      } catch (err: any) {
        vscode.window.showErrorMessage(`Hooshyar commit generator failed: ${err?.message ?? err}`);
        return null;
      }
    }
  );
}
