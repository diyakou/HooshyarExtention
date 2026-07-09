import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Hooshyar");
  }
  return channel;
}

export function logInfo(message: string): void {
  getLogger().appendLine(`[INFO] ${new Date().toISOString()} ${message}`);
}

export function logWarn(message: string): void {
  getLogger().appendLine(`[WARN] ${new Date().toISOString()} ${message}`);
}

export function logError(message: string): void {
  getLogger().appendLine(`[ERROR] ${new Date().toISOString()} ${message}`);
}

export function logDebug(message: string): void {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (cfg.get<boolean>("debugLogging", false)) {
    getLogger().appendLine(`[DEBUG] ${new Date().toISOString()} ${message}`);
  }
}
