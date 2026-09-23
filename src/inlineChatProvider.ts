import * as vscode from "vscode";
import { ApiClient } from "./apiClient";
import { ApiClientConfig } from "./apiConfig";
import { logInfo, logError } from "./logger";

export function buildInlineEditPrompt(
  languageId: string,
  userInstruction: string,
  selectedCode: string,
  surroundingContext?: string
): string {
  return (
    `You are an expert AI code editor. Modify the selected code according to the user's instructions.\n` +
    `Language: ${languageId}\n` +
    (surroundingContext ? `Surrounding context:\n\`\`\`${languageId}\n${surroundingContext}\n\`\`\`\n\n` : "") +
    `Selected code to modify:\n\`\`\`${languageId}\n${selectedCode}\n\`\`\`\n\n` +
    `User instruction: ${userInstruction}\n\n` +
    `CRITICAL INSTRUCTION: Return ONLY the replacement code for the selected block. Do NOT include any explanations, markdown code fences, or backticks unless the actual code itself contains them.`
  );
}

export async function runInlineChat(getConfig: () => ApiClientConfig): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("Hooshyar: Open a file in the editor to use Inline Chat (Ctrl+I).");
    return;
  }

  const selection = editor.selection;
  let targetRange: vscode.Range;
  let isLineFallback = false;

  if (selection.isEmpty) {
    // Target the current line
    targetRange = editor.document.lineAt(selection.active.line).range;
    isLineFallback = true;
  } else {
    targetRange = new vscode.Range(selection.start, selection.end);
  }

  const selectedText = editor.document.getText(targetRange);

  // Get surrounding context (5 lines before and 5 lines after)
  const doc = editor.document;
  const startLine = Math.max(0, targetRange.start.line - 5);
  const endLine = Math.min(doc.lineCount - 1, targetRange.end.line + 5);
  const surroundingContext = doc.getText(
    new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).range.end.character)
  );

  const userInstruction = await vscode.window.showInputBox({
    prompt: "Hooshyar Inline Edit (Ctrl+I)",
    placeHolder: "Describe change (e.g., 'Refactor into async/await', 'Add error handling', 'Write function to parse JSON')",
    ignoreFocusOut: true
  });

  if (!userInstruction || !userInstruction.trim()) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Hooshyar: Generating inline edits...",
      cancellable: true
    },
    async (progress, token) => {
      const client = new ApiClient(getConfig);
      let outputText = "";
      const abortCtrl = new AbortController();
      token.onCancellationRequested(() => abortCtrl.abort());

      const prompt = buildInlineEditPrompt(
        doc.languageId,
        userInstruction.trim(),
        selectedText,
        surroundingContext
      );

      try {
        await client.send(
          {
            messages: [{ role: "user", content: prompt }]
          },
          {
            onTextDelta: (delta) => {
              outputText += delta;
            },
            onToolUseStart: () => {},
            onToolUseInputDelta: () => {},
            onToolUseStop: () => {},
            onDone: () => {},
            onError: (err) => {
              logError(`Inline chat error: ${err}`);
            }
          },
          abortCtrl.signal
        );

        let cleanCode = outputText.trim();
        // Remove code fences if model enclosed it in markdown
        if (cleanCode.startsWith("```") && cleanCode.endsWith("```")) {
          cleanCode = cleanCode.replace(/^```[a-z]*\r?\n/, "").replace(/\r?\n```$/, "").trim();
        }

        if (!cleanCode) {
          vscode.window.showWarningMessage("Hooshyar: No code was generated.");
          return;
        }

        // Apply edit to editor
        const originalRange = targetRange;
        const editSuccess = await editor.edit((editBuilder) => {
          editBuilder.replace(originalRange, cleanCode);
        });

        if (editSuccess) {
          const action = await vscode.window.showInformationMessage(
            "Hooshyar: Inline edit applied.",
            "Accept",
            "Discard (Undo)"
          );

          if (action === "Discard (Undo)") {
            await vscode.commands.executeCommand("undo");
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Hooshyar Inline Chat failed: ${err?.message ?? err}`);
      }
    }
  );
}
