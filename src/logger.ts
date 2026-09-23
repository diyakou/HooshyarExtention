import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
const LOG_BUFFER_MAX = 2500;
const logBuffer: string[] = [];

export function getLogger(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Hooshyar");
  }
  return channel;
}

export function showLogChannel(): void {
  getLogger().show(true);
}

function appendLog(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string): void {
  const line = `[${level}] ${new Date().toISOString()} ${message}`;
  getLogger().appendLine(line);
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }
}

export function logInfo(message: string): void {
  appendLog("INFO", message);
}

export function logWarn(message: string): void {
  appendLog("WARN", message);
}

export function logError(message: string): void {
  appendLog("ERROR", message);
}

export function logDebug(message: string): void {
  const cfg = vscode.workspace.getConfiguration("hooshyar");
  if (cfg.get<boolean>("debugLogging", false)) {
    appendLog("DEBUG", message);
  }
}

export function isDebugLoggingEnabled(): boolean {
  return vscode.workspace.getConfiguration("hooshyar").get<boolean>("debugLogging", false);
}

export function getRecentLogs(): string {
  return logBuffer.join("\n");
}

export function clearLogs(): void {
  logBuffer.length = 0;
  getLogger().clear();
}

