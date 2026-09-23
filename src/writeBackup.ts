import * as vscode from "vscode";
import { resolveWorkspaceUri } from "./workspaceUtils";
import { logInfo } from "./logger";

export interface WriteBackupEntry {
  path: string;
  previousContent: string | null;
  timestamp: number;
}

function normalizeKey(p: string): string {
  return p.trim().replace(/\\/g, "/").toLowerCase();
}

let lastBackup: WriteBackupEntry | null = null;
const backupMap = new Map<string, WriteBackupEntry>();
const backupHistory: WriteBackupEntry[] = [];

export async function captureWriteBackup(relPath: string): Promise<void> {
  const normKey = normalizeKey(relPath);
  let previousContent: string | null = null;
  try {
    const { uri } = resolveWorkspaceUri(relPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    previousContent = Buffer.from(bytes).toString("utf-8");
  } catch {
    previousContent = null;
  }

  const entry: WriteBackupEntry = {
    path: relPath,
    previousContent,
    timestamp: Date.now()
  };

  lastBackup = entry;
  backupHistory.push(entry);

  // Preserve the original pre-modification content for diff comparisons
  if (!backupMap.has(normKey)) {
    backupMap.set(normKey, entry);
  }
}

export function getOriginalContent(relPath: string): string | null {
  const normKey = normalizeKey(relPath);
  const entry = backupMap.get(normKey);
  if (entry) {
    return entry.previousContent;
  }
  return null;
}

export function hasFileBackup(relPath: string): boolean {
  const normKey = normalizeKey(relPath);
  return backupMap.has(normKey);
}

export async function revertFile(relPath: string): Promise<string> {
  const normKey = normalizeKey(relPath);
  const entry = backupMap.get(normKey) ?? (lastBackup && normalizeKey(lastBackup.path) === normKey ? lastBackup : null);
  if (!entry) {
    throw new Error(`No previous backup found for '${relPath}'.`);
  }

  const { uri } = resolveWorkspaceUri(entry.path);
  if (entry.previousContent === null) {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } catch {
      /* ignore if already deleted */
    }
    logInfo(`Reverted file creation: deleted ${entry.path}`);
    backupMap.delete(normKey);
    return `Removed newly created file: ${entry.path}`;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(entry.previousContent, "utf-8"));
  logInfo(`Reverted file changes: restored ${entry.path}`);
  backupMap.delete(normKey);
  return `Restored previous content of ${entry.path}`;
}

export async function undoLastWrite(): Promise<string> {
  const entry = backupHistory.pop() || lastBackup;
  if (!entry) {
    throw new Error("No recent file write to undo.");
  }
  lastBackup = backupHistory.length > 0 ? backupHistory[backupHistory.length - 1] : null;

  const { uri } = resolveWorkspaceUri(entry.path);
  const normKey = normalizeKey(entry.path);

  if (entry.previousContent === null) {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
    } catch {
      /* ignore */
    }
    logInfo(`Undid create: deleted ${entry.path}`);
    backupMap.delete(normKey);
    return `Removed newly created file: ${entry.path}`;
  }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(entry.previousContent, "utf-8"));
  logInfo(`Undid write: restored ${entry.path}`);
  backupMap.delete(normKey);
  return `Restored previous content of ${entry.path}`;
}

export function hasWriteBackup(): boolean {
  return lastBackup !== null || backupHistory.length > 0;
}
