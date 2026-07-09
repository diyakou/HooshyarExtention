import * as vscode from "vscode";
import { resolveWorkspaceUri } from "./workspaceUtils";
import { logInfo } from "./logger";

export interface WriteBackupEntry {
  path: string;
  previousContent: string | null;
  timestamp: number;
}

let lastBackup: WriteBackupEntry | null = null;

export async function captureWriteBackup(relPath: string): Promise<void> {
  try {
    const { uri } = resolveWorkspaceUri(relPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    lastBackup = {
      path: relPath,
      previousContent: Buffer.from(bytes).toString("utf-8"),
      timestamp: Date.now()
    };
  } catch {
    lastBackup = { path: relPath, previousContent: null, timestamp: Date.now() };
  }
}

export async function undoLastWrite(): Promise<string> {
  if (!lastBackup) {
    throw new Error("No recent file write to undo.");
  }
  const { path: relPath, previousContent } = lastBackup;
  const { uri } = resolveWorkspaceUri(relPath);

  if (previousContent === null) {
    await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    logInfo(`Undid create: deleted ${relPath}`);
    lastBackup = null;
    return `Removed newly created file: ${relPath}`;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(previousContent, "utf-8"));
  logInfo(`Undid write: restored ${relPath}`);
  lastBackup = null;
  return `Restored previous content of ${relPath}`;
}

export function hasWriteBackup(): boolean {
  return lastBackup !== null;
}
