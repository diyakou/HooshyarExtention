import * as vscode from "vscode";

export class HooshyarQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      // 1. Fix with Hooshyar
      const fixAction = new vscode.CodeAction(
        `✨ Fix with Hooshyar: "${diagnostic.message.slice(0, 45)}${diagnostic.message.length > 45 ? "..." : ""}"`,
        vscode.CodeActionKind.QuickFix
      );
      fixAction.isPreferred = true;
      fixAction.diagnostics = [diagnostic];
      fixAction.command = {
        command: "hooshyar.fixDiagnostic",
        title: "Fix with Hooshyar",
        arguments: [document, diagnostic, "fix"]
      };
      actions.push(fixAction);

      // 2. Explain Error with Hooshyar
      const explainAction = new vscode.CodeAction(
        `✨ Explain Error with Hooshyar`,
        vscode.CodeActionKind.QuickFix
      );
      explainAction.diagnostics = [diagnostic];
      explainAction.command = {
        command: "hooshyar.fixDiagnostic",
        title: "Explain Error with Hooshyar",
        arguments: [document, diagnostic, "explain"]
      };
      actions.push(explainAction);
    }

    return actions;
  }
}

export function buildDiagnosticPrompt(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  mode: "fix" | "explain"
): string {
  const line = diagnostic.range.start.line;
  const startLine = Math.max(0, line - 5);
  const endLine = Math.min(document.lineCount - 1, line + 5);
  const codeContext = document.getText(
    new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).range.end.character)
  );

  const relPath = vscode.workspace.asRelativePath(document.uri, false);

  if (mode === "fix") {
    return (
      `/fix In ${relPath} line ${line + 1}:\n` +
      `Diagnostic: ${diagnostic.message} (Source: ${diagnostic.source || "linter"})\n\n` +
      `Context code:\n\`\`\`${document.languageId}\n${codeContext}\n\`\`\`\n\n` +
      `Please provide the exact fix using search_replace.`
    );
  } else {
    return (
      `/explain In ${relPath} line ${line + 1}:\n` +
      `Diagnostic: ${diagnostic.message} (Source: ${diagnostic.source || "linter"})\n\n` +
      `Context code:\n\`\`\`${document.languageId}\n${codeContext}\n\`\`\`\n\n` +
      `Why is this error happening, and what is the best practice to resolve it?`
    );
  }
}
