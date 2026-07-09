import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { HooshyarInlineCompletionProvider } from "./inlineCompletionProvider";
import { readInlineApiConfig } from "./apiConfig";
import { testProviderConnection } from "./diffPreview";
import { getLogger, logInfo } from "./logger";
import { undoLastWrite, hasWriteBackup } from "./writeBackup";

export async function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri, context.secrets, context.globalState);
  await provider.loadSecrets();
  logInfo("Hooshyar activated.");

  context.subscriptions.push(getLogger());

  let cachedInlineApiKey =
    (await context.secrets.get("hooshyar.apiKey"))
    ?? vscode.workspace.getConfiguration("hooshyar").get<string>("apiKey", "");

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
  );

  const inlineProvider = new HooshyarInlineCompletionProvider(
    () => readInlineApiConfig(cachedInlineApiKey),
    {
      isEnabled: () => vscode.workspace.getConfiguration("hooshyar").get<boolean>("enableInlineCompletions", true),
      maxPromptChars: () => vscode.workspace.getConfiguration("hooshyar").get<number>("inlineContextChars", 8000),
      debounceMs: () => vscode.workspace.getConfiguration("hooshyar").get<number>("inlineDebounceMs", 400),
      skipComments: () => vscode.workspace.getConfiguration("hooshyar").get<boolean>("inlineSkipComments", true)
    }
  );
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, inlineProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.newChat", () => provider.newChat())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.stop", () => provider.stop())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.attachFile", () => provider.attachFileCommand())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.history", () => provider.openHistory())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.testConnection", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Hooshyar: testing connection..." },
        async () => {
          const result = await testProviderConnection(() => cachedInlineApiKey);
          if (result.ok) {
            vscode.window.showInformationMessage(`Hooshyar: ${result.message}`);
          } else {
            vscode.window.showErrorMessage(`Hooshyar: ${result.message}`);
          }
        }
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.undoLastWrite", async () => {
      if (!hasWriteBackup()) {
        vscode.window.showInformationMessage("Hooshyar: nothing to undo.");
        return;
      }
      try {
        const msg = await undoLastWrite();
        vscode.window.showInformationMessage(`Hooshyar: ${msg}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Hooshyar: ${err?.message ?? err}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.openSettings", async () => {
      const choice = await vscode.window.showQuickPick(
        ["Set API Key (stored securely)", "Test Connection", "Open settings.json"],
        { placeHolder: "Hooshyar settings" }
      );
      if (choice === "Set API Key (stored securely)") {
        const key = await vscode.window.showInputBox({
          prompt: "API key for your custom provider (leave empty if none)",
          password: true
        });
        if (key !== undefined) {
          await context.secrets.store("hooshyar.apiKey", key);
          await provider.loadSecrets();
          cachedInlineApiKey = key;
          vscode.window.showInformationMessage("Hooshyar: API key saved.");
        }
      } else if (choice === "Test Connection") {
        await vscode.commands.executeCommand("hooshyar.testConnection");
      } else if (choice === "Open settings.json") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "hooshyar");
      }
    })
  );
}

export function deactivate() {}
