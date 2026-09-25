const Module = require("module");
const origRequire = Module.prototype.require;

const mockConfig = new Map();
let vscodeMock;

Module.prototype.require = function (id) {
  if (id === "vscode") {
    if (vscodeMock) return vscodeMock;
    return vscodeMock = {
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
        }),
        openTextDocument: async () => ({ languageId: "plaintext", getText: () => "" }),
        findFiles: async () => [],
        createFileSystemWatcher: () => ({ onDidCreate: () => ({ dispose: () => {} }), onDidChange: () => ({ dispose: () => {} }), onDidDelete: () => ({ dispose: () => {} }), dispose: () => {} }),
        applyEdit: async () => true
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
        file: (f) => ({ fsPath: f, scheme: "file", toString: () => `file://${f}` }),
        joinPath: (base, ...parts) => ({ fsPath: [base.fsPath, ...parts].join("/").replace(/\/+/g, "/"), scheme: "file", toString() { return `file://${this.fsPath}`; } }),
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
          if (cmd === "vscode.executeDocumentSymbolProvider") {
            return [
              {
                name: "AuthService",
                kind: 4, // Class
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 27 }
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
      tasks: { registerTaskProvider: () => ({ dispose: () => {} }) },
      Task: class { constructor(definition, scope, name, source, execution) { this.definition = definition; this.scope = scope; this.name = name; this.source = source; this.execution = execution; } },
      ShellExecution: class { constructor(command) { this.commandLine = command; } },
      TaskGroup: { Build: { id: "build" }, Test: { id: "test" } },
      tests: {
        createTestController: () => ({
          items: { add: () => {}, replace: () => {} },
          createTestItem: (id, label, uri) => ({ id, label, uri, children: { add: () => {} } }),
          createRunProfile: () => ({}),
          createTestRun: () => ({ enqueued: () => {}, passed: () => {}, failed: () => {}, skipped: () => {}, end: () => {} }),
          dispose: () => {}
        })
      },
      TestRunProfileKind: { Run: 1, Debug: 2 },
      TestMessage: class { constructor(message) { this.message = message; } },
      FileType: { File: 1, Directory: 2 },
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
