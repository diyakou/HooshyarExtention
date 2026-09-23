import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { readApiClientConfig } from "./apiConfig";
import { logDebug } from "./logger";

export interface SuggestedName {
  newSymbolName: string;
  tags?: readonly number[];
}

export class HooshyarRenameSuggestionsProvider {
  constructor(private readonly getApiKey: () => string) {}

  public async provideNewSymbolNames(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken
  ): Promise<SuggestedName[]> {
    const currentName = document.getText(range);
    if (!currentName || currentName.length < 2) return [];

    try {
      const suggestions = await this.getSuggestions(document, range, currentName, token);
      return suggestions.map((name) => ({ newSymbolName: name }));
    } catch (err: any) {
      logDebug(`[RenameSuggestions] Error generating suggestions: ${err?.message ?? err}`);
      return [];
    }
  }


  public async getSuggestions(
    document: vscode.TextDocument,
    range: vscode.Range,
    currentName: string,
    token?: vscode.CancellationToken
  ): Promise<string[]> {
    const startLine = Math.max(0, range.start.line - 15);
    const endLine = Math.min(document.lineCount - 1, range.end.line + 15);
    const contextLines = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));

    const prompt =
      `You are an expert programming naming assistant.\n` +
      `File language: ${document.languageId}\n` +
      `Current symbol name to rename: "${currentName}"\n\n` +
      `Surrounding code context:\n` +
      `\`\`\`${document.languageId}\n${contextLines}\n\`\`\`\n\n` +
      `Suggest 3 to 5 clear, concise, and idiomatic alternative names that follow standard naming conventions for ${document.languageId}.\n` +
      `Reply ONLY with a valid JSON array of strings, without explanations, markdown or code blocks. Example: ["newName1", "newName2", "newName3"]`;

    const config = readApiClientConfig(this.getApiKey());
    const client = new ApiClient(() => config);

    const controller = new AbortController();
    if (token) {
      token.onCancellationRequested(() => controller.abort());
    }

    let rawResponse = "";
    await client.send(
      {
        messages: [{ role: "user", content: prompt }],
        system: "You are a concise naming assistant. Output ONLY a valid JSON array of string names."
      },
      {
        onTextDelta: (delta) => {
          rawResponse += delta;
        },
        onToolUseStart: () => {},
        onToolUseInputDelta: () => {},
        onToolUseStop: () => {},
        onDone: () => {},
        onError: (err) => {
          logDebug(`[RenameSuggestions] Stream error: ${err}`);
        }
      },
      controller.signal
    );

    const match = rawResponse.match(/\[[\s\S]*?\]/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .map((n) => String(n).trim())
          .filter((n) => n && n !== currentName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(n))
          .slice(0, 5);
      }
    } catch {
      // Ignore parse errors
    }
    return [];
  }
}

export async function runSuggestRenameCommand(getApiKey: () => string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Please open a file with a symbol to rename.");
    return;
  }

  const document = editor.document;
  const position = editor.selection.active;
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    vscode.window.showInformationMessage("Please place the cursor on an identifier to rename.");
    return;
  }

  const currentName = document.getText(wordRange);
  const provider = new HooshyarRenameSuggestionsProvider(getApiKey);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Hooshyar: Generating rename suggestions for "${currentName}"...`
    },
   async () => {
      const suggestions = await provider.getSuggestions(document, wordRange, currentName);
      if (!suggestions.length) {
        vscode.window.showInformationMessage(`No rename suggestions found for "${currentName}".`);
        return;
      }

      const items = suggestions.map((s) => ({
        label: s,
        description: `Rename "${currentName}" -> "${s}"`
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Select a new name for "${currentName}"`
      });

      if (!picked) return;

      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        document.uri,
        position,
        picked.label
      );

      if (edit) {
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(`Renamed "${currentName}" to "${picked.label}".`);
      }
    }
  );
}
