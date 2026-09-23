import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider";
import { HooshyarInlineCompletionProvider } from "./inlineCompletionProvider";
import { EnhancedCodeLensProvider } from "./codeLensProvider";
import { ApprovalManager } from "./approvalManager";
import { readInlineApiConfig } from "./apiConfig";
import {
  testProviderConnection,
  ORIGINAL_DOC_SCHEME,
  HooshyarOriginalContentProvider,
  openDiffForFile
} from "./diffPreview";
import { getLogger, logInfo } from "./logger";
import { undoLastWrite, hasWriteBackup, revertFile } from "./writeBackup";
import { generateCommitMessage } from "./gitCommitGenerator";
import { runInlineChat } from "./inlineChatProvider";
import { HooshyarQuickFixProvider, buildDiagnosticPrompt } from "./quickFixProvider";
import { ReviewManager } from "./reviewManager";
import { MemoryManager } from "./memoryManager";
import { HooshyarRenameSuggestionsProvider, runSuggestRenameCommand } from "./renameSuggestionsProvider";

export async function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri, context.secrets, context.globalState);
  await provider.loadSecrets();
  logInfo("Hooshyar activated.");

  context.subscriptions.push(getLogger());

  // Register virtual document provider for original content in diff editor
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      ORIGINAL_DOC_SCHEME,
      new HooshyarOriginalContentProvider()
    )
  );

  let cachedInlineApiKey =
    (await context.secrets.get("hooshyar.apiKey"))
    ?? vscode.workspace.getConfiguration("hooshyar").get<string>("apiKey", "");

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
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

  // Register CodeLens provider for inline code actions
  const codeLensProvider = new EnhancedCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", pattern: "**/*.{ts,tsx,js,jsx,py,java,go,rs,c,cpp,cs,php,rb}" },
      codeLensProvider
    )
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
    vscode.commands.registerCommand("hooshyar.attachActiveFile", () => provider.attachActiveFile())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.addFileToChat", async (uri?: vscode.Uri) => {
      if (uri) {
        await provider.addUriToChat(uri);
      } else {
        await provider.attachActiveFile();
      }
    })
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
    vscode.commands.registerCommand("hooshyar.openDiff", async (relPath?: string) => {
      if (relPath) {
        await openDiffForFile(relPath, { preserveFocus: false });
      } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
          if (workspaceFolder) {
            const rel = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
            await openDiffForFile(rel, { preserveFocus: false });
          }
        }
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.revertFile", async (relPath?: string) => {
      if (!relPath) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
          if (workspaceFolder) {
            relPath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
          }
        }
      }
      if (!relPath) {
        vscode.window.showWarningMessage("Hooshyar: Open a workspace file first, or select a file from the review list to revert.");
        return;
      }
      try {
        const msg = await revertFile(relPath);
        vscode.window.showInformationMessage(`Hooshyar: ${msg}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Hooshyar: ${err?.message ?? err}`);
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.openSettings", () => {
      provider.openSettingsModal();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.showLogs", () => {
      provider.showLogs();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.copyDebugLogs", async () => {
      await provider.copyDebugLogs();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.toggleDebugLogging", async () => {
      await provider.toggleDebugLogging();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.mcpStatus", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Hooshyar: Checking MCP servers..." },
        async () => {
          const servers = await provider.getMcpServers();
          const serverNames = Object.keys(servers);
          if (serverNames.length === 0) {
            vscode.window.showInformationMessage("Hooshyar: No MCP servers configured in settings or workspace.");
            return;
          }
          const mcpManager = provider.getMcpManager();
          const tools = await mcpManager.listTools(servers);
          const statuses = mcpManager.getServerStatuses();
          const summary = statuses.map((s) => `${s.name}: ${s.status} (${s.toolCount} tools${s.error ? `, error: ${s.error}` : ""})`).join("\n");
          const failed = statuses.filter((status) => status.status === "error");
          logInfo(`MCP Servers Status:\n${summary}\nTools found (${tools.length}): ${tools.map(t => t.name).join(", ")}`);

          if (failed.length > 0) {
            const action = await vscode.window.showErrorMessage(
              `Hooshyar MCP: ${failed.length} server(s) failed. ${failed.map((status) => `${status.name}: ${status.error ?? "Unknown error"}`).join(" | ")}`,
              "Show Logs"
            );
            if (action === "Show Logs") provider.showLogs();
            return;
          }

          vscode.window.showInformationMessage(`Hooshyar MCP: ${serverNames.length} server(s) connected, ${tools.length} tool(s) available.`);
        }
      );
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.reloadMcp", async () => {
      provider.getMcpManager().dispose();
      const servers = await provider.getMcpServers();
          const tools = await provider.getMcpManager().listTools(servers);
          const failed = provider.getMcpManager().getServerStatuses().filter((status) => status.status === "error");
          if (failed.length > 0) {
            vscode.window.showErrorMessage(`Hooshyar: MCP reload failed for ${failed.map((status) => status.name).join(", ")}. Use "Hooshyar: View MCP Servers & Tools Status" for details.`);
            return;
          }
          vscode.window.showInformationMessage(`Hooshyar: Reloaded MCP servers. Found ${tools.length} tool(s).`);
    })
  );
  context.subscriptions.push({ dispose: () => provider.dispose() });

  // CodeLens commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hooshyar.askAboutCode",
      async (uri: vscode.Uri, range: vscode.Range, symbolName?: string) => {
        await handleCodeLensAction(provider, uri, range, symbolName, "ask");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hooshyar.explainCode",
      async (uri: vscode.Uri, range: vscode.Range, symbolName?: string) => {
        await handleCodeLensAction(provider, uri, range, symbolName, "explain");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hooshyar.generateTests",
      async (uri: vscode.Uri, range: vscode.Range, symbolName?: string) => {
        await handleCodeLensAction(provider, uri, range, symbolName, "test");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hooshyar.refactorCode",
      async (uri: vscode.Uri, range: vscode.Range, symbolName?: string) => {
        await handleCodeLensAction(provider, uri, range, symbolName, "refactor");
      }
    )
  );

  // 1. Git Commit Message Generator
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.generateCommitMessage", async () => {
      await generateCommitMessage(() => readInlineApiConfig(cachedInlineApiKey));
    })
  );

  // 2. Inline Chat (Ctrl+I)
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.inlineChat", async () => {
      await runInlineChat(() => readInlineApiConfig(cachedInlineApiKey));
    })
  );

  // 3. Quick Fix / Diagnostic CodeActionProvider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new HooshyarQuickFixProvider(),
      { providedCodeActionKinds: HooshyarQuickFixProvider.providedCodeActionKinds }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hooshyar.fixDiagnostic",
      async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic, mode: "fix" | "explain") => {
        const prompt = buildDiagnosticPrompt(document, diagnostic, mode);
        await vscode.commands.executeCommand("hooshyar.chatView.focus");
        await provider.sendMessageFromCommand(prompt);
      }
    )
  );

  // 4. Terminal Integration (Explain Terminal Error / Selection)
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.explainTerminal", async () => {
      const clip = await vscode.env.clipboard.readText();
      const prompt =
        clip && clip.length < 5000 && !clip.includes("\n\n\n")
          ? `/explain Terminal error or output:\n\`\`\`bash\n${clip}\n\`\`\`\nWhat caused this error and how do I fix it?`
          : `/explain Please analyze my latest terminal error and explain how to resolve it.`;
      await vscode.commands.executeCommand("hooshyar.chatView.focus");
      await provider.sendMessageFromCommand(prompt);
    })
  );

  // 5. Multi-File Review Manager
  const reviewManager = ReviewManager.getInstance();
  context.subscriptions.push(reviewManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.reviewChanges", async () => {
      await reviewManager.showReviewQuickPick();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.acceptAllEdits", () => {
      reviewManager.acceptAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.discardAllEdits", async () => {
      await reviewManager.discardAll();
    })
  );

  // 6. Developer Persistent Memory Manager
  MemoryManager.getInstance().initialize(context.globalState);

  // 7. AI Rename Suggestions (F2 and Command)
  const renameProvider = new HooshyarRenameSuggestionsProvider(() => cachedInlineApiKey);
  if ("registerNewSymbolNamesProvider" in (vscode.languages as any)) {
    try {
      context.subscriptions.push(
        (vscode.languages as any).registerNewSymbolNamesProvider(
          { scheme: "file" },
          renameProvider
        )
      );
    } catch {
      // Ignore if proposed API is restricted in current VS Code build
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.suggestRename", async () => {
      await runSuggestRenameCommand(() => cachedInlineApiKey);
    })
  );

  // Auto-approve mode commands
  context.subscriptions.push(
    vscode.commands.registerCommand("hooshyar.changeAutoApproveMode", async () => {
      await ApprovalManager.promptChangeAutoApproveMode();
      // Update status bar after change
      if (autoApproveStatusBar) {
        autoApproveStatusBar.dispose();
        autoApproveStatusBar = ApprovalManager.createStatusBarItem();
        context.subscriptions.push(autoApproveStatusBar);
      }
    })
  );

  // Create status bar item for auto-approve mode
  let autoApproveStatusBar = ApprovalManager.createStatusBarItem();
  context.subscriptions.push(autoApproveStatusBar);

  // Update status bar when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("hooshyar.autoApproveMode")) {
        if (autoApproveStatusBar) {
          autoApproveStatusBar.dispose();
        }
        autoApproveStatusBar = ApprovalManager.createStatusBarItem();
        context.subscriptions.push(autoApproveStatusBar);
      }
    })
  );
}

/**
 * Handle CodeLens action by sending appropriate prompt to chat
 */
async function handleCodeLensAction(
  provider: ChatViewProvider,
  uri: vscode.Uri,
  range: vscode.Range,
  symbolName: string | undefined,
  action: "ask" | "explain" | "test" | "refactor"
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const code = document.getText(range);
    const language = document.languageId;
    const fileName = vscode.workspace.asRelativePath(uri);

    // Build prompt based on action
    let prompt = "";
    const codeBlock = `\`\`\`${language}\n${code}\n\`\`\``;

    switch (action) {
      case "ask":
        // Show input box for custom question
        const question = await vscode.window.showInputBox({
          prompt: `Ask about ${symbolName || "this code"}`,
          placeHolder: "What would you like to know about this code?"
        });
        if (!question) return;
        prompt = `Regarding this code from \`${fileName}\`:\n\n${codeBlock}\n\n${question}`;
        break;

      case "explain":
        prompt = `Please explain this code from \`${fileName}\`${symbolName ? ` (${symbolName})` : ""}:\n\n${codeBlock}\n\nProvide a clear explanation of what this code does, how it works, and any important details.`;
        break;

      case "test":
        prompt = `Generate comprehensive unit tests for this function from \`${fileName}\`${symbolName ? ` (${symbolName})` : ""}:\n\n${codeBlock}\n\nCreate tests that cover:\n- Normal/happy path cases\n- Edge cases\n- Error handling\n- Use the appropriate testing framework for ${language}.`;
        break;

      case "refactor":
        prompt = `Analyze this code from \`${fileName}\`${symbolName ? ` (${symbolName})` : ""} and suggest refactoring improvements:\n\n${codeBlock}\n\nProvide:\n1. Code quality issues (if any)\n2. Performance improvements\n3. Better naming or structure suggestions\n4. Modern best practices for ${language}\n\nIf the code is already good, just say so. If you suggest changes, use \`search_replace\` to apply them.`;
        break;
    }

    // Send to chat (make view visible first)
    await vscode.commands.executeCommand("hooshyar.chatView.focus");
    await provider.sendMessageFromCommand(prompt);
  } catch (error: any) {
    vscode.window.showErrorMessage(`Hooshyar CodeLens error: ${error?.message ?? error}`);
  }
}

export function deactivate() {}
