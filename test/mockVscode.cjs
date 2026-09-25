const Module = require("module");
const origRequire = Module.prototype.require;

const mockConfig = new Map();

Module.prototype.require = function (id) {
  if (id === "vscode") {
    return {
      workspace: {
        workspaceFolders: [],
        fs: {},
        asRelativePath: (u) => (typeof u === "string" ? u : u.fsPath || ""),
        _setConfig: (key, val) => {
          if (val === undefined) mockConfig.delete(key);
          else mockConfig.set(key, val);
        },
        _clearConfig: () => mockConfig.clear(),
        getConfiguration: (section) => ({
          get: (key, def) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfig.has(fullKey)) return mockConfig.get(fullKey);
            if (mockConfig.has(key)) return mockConfig.get(key);
            return def;
          },
          update: async (key, val) => {
            mockConfig.set(key, val);
          }
        })
      },
      window: {
        terminals: [],
        createOutputChannel: () => ({
          appendLine: () => {},
          clear: () => {},
          show: () => {},
          dispose: () => {}
        }),
        createTerminal: (name) => {
          const term = {
            name: typeof name === "string" ? name : name?.name || "Terminal",
            show: () => {},
            sendText: () => {},
            dispose: () => {}
          };
          return term;
        },
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        showInformationMessage: () => Promise.resolve(),
        showWarningMessage: () => Promise.resolve(),
        showErrorMessage: () => Promise.resolve()
      },
      Uri: {
        file: (f) => ({ fsPath: f, scheme: "file" }),
        parse: (u) => ({ toString: () => u })
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async (cmd, ...args) => {
          if (cmd === "vscode.executeWorkspaceSymbolProvider") {
            return [
              {
                name: "UserService",
                kind: 5, // Class
                containerName: "auth",
                location: {
                  uri: { fsPath: "/workspace/src/auth.ts" },
                  range: { start: { line: 10, character: 0 } }
                }
              }
            ];
          }
          return undefined;
        }
      },
      languages: {
        getDiagnostics: (resource) => {
          return [
            [
              { fsPath: "/workspace/src/index.ts" },
              [
                {
                  message: "Cannot find module 'express'",
                  severity: 0, // Error
                  source: "typescript",
                  code: 2307,
                  range: {
                    start: { line: 0, character: 7 },
                    end: { line: 0, character: 16 }
                  }
                }
              ]
            ]
          ];
        },
        registerNewSymbolNamesProvider: () => ({ dispose: () => {} })
      },
      SymbolKind: {
        File: 0,
        Module: 1,
        Namespace: 2,
        Package: 3,
        Class: 4,
        Method: 5,
        Property: 6,
        Field: 7,
        Constructor: 8,
        Enum: 9,
        Interface: 10,
        Function: 11,
        Variable: 12,
        Constant: 13,
        String: 14,
        Number: 15,
        Boolean: 16,
        Array: 17,
        Object: 18,
        Key: 19,
        Null: 20,
        EnumMember: 21,
        Struct: 22,
        Event: 23,
        Operator: 24,
        TypeParameter: 25
      },
      DiagnosticSeverity: {
        Error: 0,
        Warning: 1,
        Information: 2,
        Hint: 3
      },
      ProgressLocation: {
        SourceControl: 1,
        Window: 10,
        Notification: 15
      },
      Range: class {
        constructor(start, end) {
          this.start = start;
          this.end = end;
        }
      },
      Position: class {
        constructor(line, character) {
          this.line = line;
          this.character = character;
        }
      },
      WorkspaceEdit: class {},
      CodeActionKind: {
        QuickFix: { value: "quickfix" }
      },
      CodeAction: class {
        constructor(title, kind) {
          this.title = title;
          this.kind = kind;
        }
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      }
    };
  }
  return origRequire.apply(this, arguments);
};
