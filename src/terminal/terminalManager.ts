import * as vscode from "vscode";

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly outputBuffers = new Map<string, string[]>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    // Do not probe proposed terminal-data APIs here: reading one can prevent a
    // normally installed extension from activating. Agent command output is
    // captured through child_process, so this manager uses stable lifecycle APIs.
    if (typeof vscode.window.onDidCloseTerminal === "function") {
      this.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => {
        this.terminals.delete(terminal.name);
        this.outputBuffers.delete(terminal.name);
      }));
    }
  }

  getOrCreateTerminal(name: string, cwd?: string): vscode.Terminal {
    let terminal = this.terminals.get(name);
    if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({ name, cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
      this.terminals.set(name, terminal);
      this.outputBuffers.set(name, []);
    } else if (cwd) {
      terminal.sendText(`cd "${cwd.replace(/"/g, "\\\"")}"`, true);
    }
    return terminal;
  }

  executeInTerminal(name: string, command: string, options: { cwd?: string; show?: boolean } = {}): void {
    const terminal = this.getOrCreateTerminal(name, options.cwd);
    if (options.show !== false) terminal.show(true);
    terminal.sendText(command, true);
  }

  sendInput(name: string, input: string): void {
    const terminal = this.terminals.get(name);
    if (!terminal) throw new Error(`Terminal '${name}' does not exist.`);
    terminal.sendText(input, true);
  }

  getOutput(name: string, maxChars = 20_000): string {
    const output = (this.outputBuffers.get(name) || []).join("");
    return output.length > maxChars ? `${output.slice(-maxChars)}\n[terminal output truncated]` : output;
  }

  clearOutput(name: string): void {
    this.outputBuffers.set(name, []);
  }

  closeTerminal(name: string): void {
    const terminal = this.terminals.get(name);
    if (terminal) terminal.dispose();
    this.terminals.delete(name);
    this.outputBuffers.delete(name);
  }

  closeAllTerminals(): void {
    for (const terminal of this.terminals.values()) terminal.dispose();
    this.terminals.clear();
    this.outputBuffers.clear();
  }

  listTerminals(): string[] {
    return [...this.terminals.keys()];
  }

  getTerminal(name: string): vscode.Terminal | undefined {
    return this.terminals.get(name);
  }

  dispose(): void {
    this.closeAllTerminals();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions.length = 0;
  }
}

let globalTerminalManager: TerminalManager | undefined;

export function getTerminalManager(): TerminalManager {
  globalTerminalManager ??= new TerminalManager();
  return globalTerminalManager;
}
