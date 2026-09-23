import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { readApiClientConfig } from "./apiConfig";
import { logInfo, logError } from "./logger";
import { resolveWorkspaceUri } from "./workspaceUtils";
import { getOriginalContent } from "./writeBackup";

export { buildInlineDiffPreview } from "./inlineDiff";

export const ORIGINAL_DOC_SCHEME = "hooshyar-original";

export class HooshyarOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const relPath = uri.path.replace(/^\//, "");
    const original = getOriginalContent(relPath);
    return original ?? "";
  }

  notifyChanged(uri: vscode.Uri) {
    this._onDidChange.fire(uri);
  }
}

export async function openDiffForFile(
  relPath: string,
  options?: { preserveFocus?: boolean; viewColumn?: vscode.ViewColumn }
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  const normalized = relPath.trim().replace(/\\/g, "/");
  const { uri: rightUri } = resolveWorkspaceUri(normalized);
  const original = getOriginalContent(normalized);

  // File was newly created: show it as a proper empty-to-new diff.
  if (original === null) {
    const leftUri = vscode.Uri.from({
      scheme: ORIGINAL_DOC_SCHEME,
      path: "/" + normalized,
      query: `t=${Date.now()}`
    });
    const fileName = path.basename(normalized);
    try {
      await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, `${fileName} (جدید توسط هوشیار)`, {
        preview: false,
        preserveFocus: options?.preserveFocus ?? true,
        viewColumn: options?.viewColumn
      });
      logInfo(`Opened new-file diff editor for: ${normalized}`);
    } catch (err: any) {
      logError(`Failed to open new-file diff for ${normalized}: ${err?.message ?? err}`);
    }
    return;
  }

  // File was modified: open side-by-side native VS Code diff
  const leftUri = vscode.Uri.from({
    scheme: ORIGINAL_DOC_SCHEME,
    path: "/" + normalized,
    query: `t=${Date.now()}`
  });

  const fileName = path.basename(normalized);
  const title = `${fileName} (قبل ↔ بعد از ویرایش هوشیار)`;

  try {
    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
      preview: false,
      preserveFocus: options?.preserveFocus ?? true,
      viewColumn: options?.viewColumn
    });
    logInfo(`Opened diff editor for: ${normalized}`);
  } catch (err: any) {
    logError(`Failed to open diff for ${normalized}: ${err?.message ?? err}`);
  }
}

export async function testProviderConnection(getApiKey: () => string): Promise<{ ok: boolean; message: string }> {
  const cfg = readApiClientConfig(getApiKey());
  const client = new ApiClient(() => cfg);

  let text = "";
  let error = "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.requestTimeoutMs, 30_000));

  try {
    await client.send(
      {
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        system: "You are a connectivity test. Reply briefly."
      },
      {
        onTextDelta: (t) => {
          text += t;
        },
        onToolUseStart: () => {},
        onToolUseInputDelta: () => {},
        onToolUseStop: () => {},
        onDone: () => {},
        onError: (m) => {
          error = m;
        }
      },
      controller.signal
    );
  } finally {
    clearTimeout(timer);
  }

  if (error) {
    logInfo(`Connection test failed: ${error}`);
    return { ok: false, message: error };
  }
  if (!text.trim()) {
    return { ok: false, message: "Connected but received an empty response." };
  }
  return { ok: true, message: `Connected. Model responded: ${text.trim().slice(0, 80)}` };
}

export async function showWriteDiff(relPath: string, newContent: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (!cfg.get<boolean>("showDiffBeforeWrite", true)) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  let oldContent = "";
  try {
    const { uri } = resolveWorkspaceUri(relPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    oldContent = Buffer.from(bytes).toString("utf-8");
  } catch {
    oldContent = "";
  }

  const tmpDir = path.join(os.tmpdir(), "hooshyar-diff");
  await fs.mkdir(tmpDir, { recursive: true });
  const safeName = relPath.replace(/[/\\]/g, "_");
  const proposedPath = path.join(tmpDir, `${safeName}.proposed`);
  await fs.writeFile(proposedPath, newContent, "utf-8");

  const leftUri =
    oldContent.length > 0
      ? vscode.Uri.file(path.join(tmpDir, `${safeName}.original`))
      : vscode.Uri.parse("untitled:empty");
  if (oldContent.length > 0) {
    await fs.writeFile(leftUri.fsPath, oldContent, "utf-8");
  } else {
    const doc = await vscode.workspace.openTextDocument({ content: "", language: "plaintext" });
    await vscode.commands.executeCommand(
      "vscode.diff",
      doc.uri,
      vscode.Uri.file(proposedPath),
      `${relPath} (current ↔ proposed)`
    );
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.diff",
    leftUri,
    vscode.Uri.file(proposedPath),
    `${relPath} (current ↔ proposed)`
  );
}
