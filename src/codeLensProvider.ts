import * as vscode from "vscode";

/**
 * Provides inline code actions (CodeLens) above functions, classes, and methods
 * for quick Hooshyar interactions.
 */
export class HooshyarCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private isEnabled = true;

  constructor() {
    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("hooshyar.enableCodeLens")) {
        this.isEnabled = vscode.workspace
          .getConfiguration("hooshyar")
          .get<boolean>("enableCodeLens", true);
        this._onDidChangeCodeLenses.fire();
      }
    });

    this.isEnabled = vscode.workspace
      .getConfiguration("hooshyar")
      .get<boolean>("enableCodeLens", true);
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    if (!this.isEnabled) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const symbols = this.findRelevantSymbols(document);

    for (const symbol of symbols) {
      const range = symbol.range;
      
      // "Ask Hooshyar about this"
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(comment-discussion) Ask Hooshyar",
          tooltip: "Ask Hooshyar about this code",
          command: "hooshyar.askAboutCode",
          arguments: [document.uri, range]
        })
      );

      // "Explain this"
      lenses.push(
        new vscode.CodeLens(range, {
          title: "$(book) Explain",
          tooltip: "Get explanation of this code",
          command: "hooshyar.explainCode",
          arguments: [document.uri, range]
        })
      );

      // "Generate tests" (only for functions/methods)
      if (
        symbol.kind === vscode.SymbolKind.Function ||
        symbol.kind === vscode.SymbolKind.Method
      ) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(beaker) Generate Tests",
            tooltip: "Generate unit tests for this function",
            command: "hooshyar.generateTests",
            arguments: [document.uri, range]
          })
        );
      }

      // "Refactor" (for functions, methods, classes)
      if (
        symbol.kind === vscode.SymbolKind.Function ||
        symbol.kind === vscode.SymbolKind.Method ||
        symbol.kind === vscode.SymbolKind.Class
      ) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(wrench) Refactor",
            tooltip: "Suggest refactoring improvements",
            command: "hooshyar.refactorCode",
            arguments: [document.uri, range]
          })
        );
      }
    }

    return lenses;
  }

  /**
   * Find symbols worth showing CodeLens for (functions, classes, methods, interfaces)
   */
  private findRelevantSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    // This is a simplified version - in practice we'd use document symbols API
    const symbols: vscode.DocumentSymbol[] = [];
    const relevantKinds = new Set([
      vscode.SymbolKind.Function,
      vscode.SymbolKind.Method,
      vscode.SymbolKind.Class,
      vscode.SymbolKind.Interface,
      vscode.SymbolKind.Constructor
    ]);

    // Use regex to find function/class declarations as fallback
    const text = document.getText();
    const lines = text.split("\n");

    // TypeScript/JavaScript patterns
    const functionPatterns = [
      /^\s*(export\s+)?(async\s+)?function\s+(\w+)/,
      /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/,
      /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*{/,
      /^\s*(export\s+)?(default\s+)?class\s+(\w+)/,
      /^\s*(export\s+)?interface\s+(\w+)/
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of functionPatterns) {
        const match = pattern.exec(line);
        if (match) {
          const range = new vscode.Range(i, 0, i, line.length);
          // Create a dummy symbol (we'll use proper symbols API in real implementation)
          const symbol: any = {
            name: match[match.length - 1] || "anonymous",
            kind: line.includes("class")
              ? vscode.SymbolKind.Class
              : line.includes("interface")
              ? vscode.SymbolKind.Interface
              : vscode.SymbolKind.Function,
            range: range,
            selectionRange: range
          };
          symbols.push(symbol);
          break;
        }
      }
    }

    return symbols;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}

/**
 * Enhanced CodeLens provider that uses VS Code's DocumentSymbol API
 * for accurate symbol detection.
 */
export class EnhancedCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private isEnabled = true;
  private maxLensesPerFile = 50; // Prevent performance issues

  constructor() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("hooshyar.enableCodeLens") ||
        e.affectsConfiguration("hooshyar.codeLensMaxItems")
      ) {
        this.isEnabled = vscode.workspace
          .getConfiguration("hooshyar")
          .get<boolean>("enableCodeLens", true);
        this.maxLensesPerFile = vscode.workspace
          .getConfiguration("hooshyar")
          .get<number>("codeLensMaxItems", 50);
        this._onDidChangeCodeLenses.fire();
      }
    });

    this.isEnabled = vscode.workspace
      .getConfiguration("hooshyar")
      .get<boolean>("enableCodeLens", true);
    this.maxLensesPerFile = vscode.workspace
      .getConfiguration("hooshyar")
      .get<number>("codeLensMaxItems", 50);
  }

  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (!this.isEnabled) {
      return [];
    }

    try {
      // Use VS Code's built-in symbol provider
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri
      );

      if (!symbols || symbols.length === 0) {
        return [];
      }

      const lenses: vscode.CodeLens[] = [];
      const relevantKinds = new Set([
        vscode.SymbolKind.Function,
        vscode.SymbolKind.Method,
        vscode.SymbolKind.Class,
        vscode.SymbolKind.Interface,
        vscode.SymbolKind.Constructor,
        vscode.SymbolKind.Struct,
        vscode.SymbolKind.Module
      ]);

      const processSymbol = (symbol: vscode.DocumentSymbol, depth: number = 0) => {
        if (lenses.length >= this.maxLensesPerFile) {
          return;
        }

        if (relevantKinds.has(symbol.kind)) {
          const range = symbol.selectionRange;

          // Ask Hooshyar
          lenses.push(
            new vscode.CodeLens(range, {
              title: "$(comment-discussion) Ask",
              tooltip: "Ask Hooshyar about this code",
              command: "hooshyar.askAboutCode",
              arguments: [document.uri, symbol.range, symbol.name]
            })
          );

          // Explain
          lenses.push(
            new vscode.CodeLens(range, {
              title: "$(book) Explain",
              tooltip: "Get explanation",
              command: "hooshyar.explainCode",
              arguments: [document.uri, symbol.range, symbol.name]
            })
          );

          // Generate tests (functions/methods only)
          if (
            symbol.kind === vscode.SymbolKind.Function ||
            symbol.kind === vscode.SymbolKind.Method ||
            symbol.kind === vscode.SymbolKind.Constructor
          ) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: "$(beaker) Tests",
                tooltip: "Generate unit tests",
                command: "hooshyar.generateTests",
                arguments: [document.uri, symbol.range, symbol.name]
              })
            );
          }

          // Refactor (functions, methods, classes)
          if (
            symbol.kind === vscode.SymbolKind.Function ||
            symbol.kind === vscode.SymbolKind.Method ||
            symbol.kind === vscode.SymbolKind.Class ||
            symbol.kind === vscode.SymbolKind.Module
          ) {
            lenses.push(
              new vscode.CodeLens(range, {
                title: "$(wrench) Refactor",
                tooltip: "Suggest improvements",
                command: "hooshyar.refactorCode",
                arguments: [document.uri, symbol.range, symbol.name]
              })
            );
          }
        }

        // Process nested symbols (methods inside classes, etc.)
        if (symbol.children && depth < 3) {
          for (const child of symbol.children) {
            processSymbol(child, depth + 1);
          }
        }
      };

      for (const symbol of symbols) {
        processSymbol(symbol);
      }

      return lenses;
    } catch (error) {
      // Silently fail if symbol provider not available
      return [];
    }
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}
