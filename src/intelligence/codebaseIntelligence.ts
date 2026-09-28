import * as vscode from 'vscode';
import * as path from 'path';
import { logDebug, logWarn } from '../logger';
import { resolveWorkspaceUri, getWorkspaceFolders } from '../workspaceUtils';

export interface SymbolRef {
    name: string;
    file: string;
    startLine: number;
    endLine: number;
}

export interface SymbolInfo {
    name: string;
    kind: string; // function/method/class/interface/variable/property/enum/namespace/module/type
    file: string; // relative path
    startLine: number;
    endLine: number;
    containerName?: string;
    dependencies: SymbolRef[];
    references: SymbolRef[];
    callers: SymbolRef[];
    relatedTests: string[];
}

export interface FileOutline {
    file: string; // relative path
    symbols: SymbolInfo[];
    imports: string[];
    exports: string[];
}

export class CodebaseIntelligence implements vscode.Disposable {
    private static instance: CodebaseIntelligence;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    // Caches
    private outlineCache = new Map<string, { data: FileOutline, timestamp: number }>();
    private referenceCache = new Map<string, { data: SymbolRef[], timestamp: number }>();
    
    private readonly OUTLINE_TTL = 30 * 1000;
    private readonly REF_TTL = 60 * 1000;

    private constructor() {
        const workspaceFolders = getWorkspaceFolders();
        if (workspaceFolders.length > 0) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
            this.disposables.push(this.fileWatcher);
            
            this.fileWatcher.onDidChange(e => this.invalidateCache(e.fsPath));
            this.fileWatcher.onDidDelete(e => this.invalidateCache(e.fsPath));
            this.fileWatcher.onDidCreate(e => this.invalidateCache(e.fsPath));
        }
    }

    public static getCodebaseIntelligence(): CodebaseIntelligence {
        if (!CodebaseIntelligence.instance) {
            CodebaseIntelligence.instance = new CodebaseIntelligence();
        }
        return CodebaseIntelligence.instance;
    }

    private invalidateCache(fsPath: string) {
        logDebug(`Invalidating cache for ${fsPath}`);
        this.outlineCache.delete(fsPath);
        this.referenceCache.clear();
    }

    /**
     * Public API: invalidate cached data for a file (by relative or absolute path).
     * Called by AgentRuntime after the agent edits a file.
     */
    public invalidateFile(filePath: string): void {
        // Try to resolve relative path to absolute
        try {
            const resolved = resolveWorkspaceUri(filePath);
            this.invalidateCache(resolved.uri.fsPath);
        } catch {
            // Fallback: try as-is (might be an absolute path)
            this.invalidateCache(filePath);
        }
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }

    private mapSymbolKind(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Function: return 'function';
            case vscode.SymbolKind.Method: return 'method';
            case vscode.SymbolKind.Class: return 'class';
            case vscode.SymbolKind.Interface: return 'interface';
            case vscode.SymbolKind.Variable: return 'variable';
            case vscode.SymbolKind.Property: return 'property';
            case vscode.SymbolKind.Enum: return 'enum';
            case vscode.SymbolKind.Namespace: return 'namespace';
            case vscode.SymbolKind.Module: return 'module';
            case vscode.SymbolKind.TypeParameter:
            case vscode.SymbolKind.Struct: return 'type';
            default: return 'unknown';
        }
    }

    private getRelativePath(uri: vscode.Uri): string {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (workspaceFolder) {
            return path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, '/');
        }
        return uri.fsPath;
    }

    public async getFileOutline(filePath: string): Promise<FileOutline> {
        const resolved = resolveWorkspaceUri(filePath);
        if (!resolved) {
            throw new Error(`Could not resolve URI for ${filePath}`);
        }
        
        const { uri } = resolved;
        const fsPath = uri.fsPath;
        const cached = this.outlineCache.get(fsPath);
        if (cached && (Date.now() - cached.timestamp) < this.OUTLINE_TTL) {
            return cached.data;
        }

        const relativePath = this.getRelativePath(uri);
        const outline: FileOutline = {
            file: relativePath,
            symbols: [],
            imports: [],
            exports: []
        };

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>(
                'vscode.executeDocumentSymbolProvider', uri
            );

            if (symbols && symbols.length > 0) {
                const processSymbol = (sym: any, containerName?: string) => {
                    const range = sym.range || sym.location?.range;
                    if (!range) return;

                    const symInfo: SymbolInfo = {
                        name: sym.name,
                        kind: this.mapSymbolKind(sym.kind),
                        file: relativePath,
                        startLine: range.start.line,
                        endLine: range.end.line,
                        containerName: containerName || sym.containerName,
                        dependencies: [],
                        references: [],
                        callers: [],
                        relatedTests: []
                    };
                    outline.symbols.push(symInfo);

                    if (sym.children) {
                        for (const child of sym.children) {
                            processSymbol(child, sym.name);
                        }
                    }
                };

                for (const sym of symbols) {
                    processSymbol(sym);
                }
            } else {
                await this.applyRegexFallback(uri.fsPath, outline);
            }

            await this.extractImportsExports(uri.fsPath, outline);

        } catch (e) {
            logWarn(`Failed to get symbols for ${filePath}, using fallback: ${e instanceof Error ? e.message : String(e)}`);
            await this.applyRegexFallback(uri.fsPath, outline);
            await this.extractImportsExports(uri.fsPath, outline);
        }

        this.outlineCache.set(fsPath, { data: outline, timestamp: Date.now() });
        return outline;
    }

    private async extractImportsExports(fsPath: string, outline: FileOutline) {
        try {
            const document = await vscode.workspace.openTextDocument(fsPath);
            const text = document.getText();
            
            const importRegex = /import\s+.*?\s+from\s+['"](.*?)['"]|import\s+['"](.*?)['"]|from\s+([^\s]+)\s+import/g;
            let match;
            while ((match = importRegex.exec(text)) !== null) {
                const imp = match[1] || match[2] || match[3];
                if (imp && !outline.imports.includes(imp)) {
                    outline.imports.push(imp);
                }
            }

            const exportRegex = /export\s+(?:const|let|var|function|class|interface|type)\s+([a-zA-Z0-9_]+)/g;
            while ((match = exportRegex.exec(text)) !== null) {
                if (match[1] && !outline.exports.includes(match[1])) {
                    outline.exports.push(match[1]);
                }
            }
        } catch (e) {
            logWarn(`Error extracting imports/exports for ${fsPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private async applyRegexFallback(fsPath: string, outline: FileOutline) {
        try {
            const document = await vscode.workspace.openTextDocument(fsPath);
            const text = document.getText();
            const lines = text.split('\n');

            const classRegex = /class\s+([a-zA-Z0-9_]+)/;
            const funcRegex = /function\s+([a-zA-Z0-9_]+)|def\s+([a-zA-Z0-9_]+)/;
            const interfaceRegex = /interface\s+([a-zA-Z0-9_]+)/;
            
            let currentContainer: string | undefined = undefined;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let match = classRegex.exec(line);
                if (match) {
                    currentContainer = match[1];
                    outline.symbols.push(this.createFallbackSymbol(match[1], 'class', outline.file, i, i));
                    continue;
                }
                
                match = funcRegex.exec(line);
                if (match) {
                    const name = match[1] || match[2];
                    outline.symbols.push(this.createFallbackSymbol(name, 'function', outline.file, i, i, currentContainer));
                    continue;
                }

                match = interfaceRegex.exec(line);
                if (match) {
                    outline.symbols.push(this.createFallbackSymbol(match[1], 'interface', outline.file, i, i));
                }
            }
        } catch (e) {
            logWarn(`Error in regex fallback for ${fsPath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private createFallbackSymbol(name: string, kind: string, file: string, line: number, endLine: number, containerName?: string): SymbolInfo {
        return {
            name, kind, file, startLine: line, endLine, containerName, dependencies: [], references: [], callers: [], relatedTests: []
        };
    }

    public async findSymbol(query: string): Promise<SymbolInfo[]> {
        const results: SymbolInfo[] = [];
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query);
            if (symbols) {
                for (const sym of symbols) {
                    results.push({
                        name: sym.name,
                        kind: this.mapSymbolKind(sym.kind),
                        file: this.getRelativePath(sym.location.uri),
                        startLine: sym.location.range.start.line,
                        endLine: sym.location.range.end.line,
                        containerName: sym.containerName,
                        dependencies: [],
                        references: [],
                        callers: [],
                        relatedTests: []
                    });
                }
            }
        } catch (e) {
            logWarn(`Error finding workspace symbol ${query}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return results;
    }

    public async getSymbolAtLocation(file: string, line: number): Promise<SymbolInfo | undefined> {
        const outline = await this.getFileOutline(file);
        let bestMatch: SymbolInfo | undefined;
        let smallestRange = Infinity;

        for (const sym of outline.symbols) {
            if (line >= sym.startLine && line <= sym.endLine) {
                const range = sym.endLine - sym.startLine;
                if (range < smallestRange) {
                    smallestRange = range;
                    bestMatch = sym;
                }
            }
        }
        return bestMatch;
    }

    public async findReferences(file: string, line: number, character: number): Promise<SymbolRef[]> {
        const resolved = resolveWorkspaceUri(file);
        if (!resolved) return [];
        const { uri } = resolved;
        
        const cacheKey = `${uri.fsPath}:${line}:${character}:refs`;
        const cached = this.referenceCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.REF_TTL) {
            return cached.data;
        }

        const refs: SymbolRef[] = [];
        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider', uri, new vscode.Position(line, character)
            );
            if (locations) {
                for (const loc of locations) {
                    refs.push({
                        name: 'Reference',
                        file: this.getRelativePath(loc.uri),
                        startLine: loc.range.start.line,
                        endLine: loc.range.end.line
                    });
                }
            }
        } catch (e) {
            logWarn(`Error finding references at ${file}:${line}: ${e instanceof Error ? e.message : String(e)}`);
        }

        this.referenceCache.set(cacheKey, { data: refs, timestamp: Date.now() });
        return refs;
    }

    public async findCallers(file: string, line: number, character: number): Promise<SymbolRef[]> {
        const resolved = resolveWorkspaceUri(file);
        if (!resolved) return [];
        const { uri } = resolved;

        const callers: SymbolRef[] = [];
        try {
            const pos = new vscode.Position(line, character);
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy', uri, pos
            );
            if (items && items.length > 0) {
                const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                    'vscode.provideIncomingCalls', items[0]
                );
                if (incoming) {
                    for (const call of incoming) {
                        callers.push({
                            name: call.from.name,
                            file: this.getRelativePath(call.from.uri),
                            startLine: call.from.range.start.line,
                            endLine: call.from.range.end.line
                        });
                    }
                }
            }
        } catch (e) {
            logWarn(`Error finding callers at ${file}:${line}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return callers;
    }

    public async findDependencies(file: string, line: number, character: number): Promise<SymbolRef[]> {
        const resolved = resolveWorkspaceUri(file);
        if (!resolved) return [];
        const { uri } = resolved;

        const deps: SymbolRef[] = [];
        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeDefinitionProvider', uri, new vscode.Position(line, character)
            );
            
            if (locations) {
                for (const loc of locations) {
                    if ('targetUri' in loc) {
                        deps.push({
                            name: 'Definition',
                            file: this.getRelativePath(loc.targetUri),
                            startLine: loc.targetRange.start.line,
                            endLine: loc.targetRange.end.line
                        });
                    } else {
                        deps.push({
                            name: 'Definition',
                            file: this.getRelativePath(loc.uri),
                            startLine: loc.range.start.line,
                            endLine: loc.range.end.line
                        });
                    }
                }
            }
        } catch (e) {
            logWarn(`Error finding dependencies at ${file}:${line}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return deps;
    }

    public async findImplementations(file: string, line: number, character: number): Promise<SymbolRef[]> {
        const resolved = resolveWorkspaceUri(file);
        if (!resolved) return [];
        const { uri } = resolved;

        const impls: SymbolRef[] = [];
        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
                'vscode.executeImplementationProvider', uri, new vscode.Position(line, character)
            );
            
            if (locations) {
                for (const loc of locations) {
                    if ('targetUri' in loc) {
                        impls.push({
                            name: 'Implementation',
                            file: this.getRelativePath(loc.targetUri),
                            startLine: loc.targetRange.start.line,
                            endLine: loc.targetRange.end.line
                        });
                    } else {
                        impls.push({
                            name: 'Implementation',
                            file: this.getRelativePath(loc.uri),
                            startLine: loc.range.start.line,
                            endLine: loc.range.end.line
                        });
                    }
                }
            }
        } catch (e) {
            logWarn(`Error finding implementations at ${file}:${line}: ${e instanceof Error ? e.message : String(e)}`);
        }
        return impls;
    }

    public async findRelatedTests(filePath: string): Promise<string[]> {
        const resolved = resolveWorkspaceUri(filePath);
        if (!resolved) return [];
        const { uri } = resolved;

        const basename = path.basename(uri.fsPath);
        const nameWithoutExt = basename.replace(/\.[^/.]+$/, "");
        
        const testFiles: string[] = [];
        try {
            const pattern = `**/*{${nameWithoutExt}.test,${nameWithoutExt}.spec,test/${nameWithoutExt},tests/${nameWithoutExt},__tests__/${nameWithoutExt}}*.*`;
            const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
            
            for (const u of uris) {
                testFiles.push(this.getRelativePath(u));
            }
        } catch(e) {
            logWarn(`Error finding related tests for ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
        
        return [...new Set(testFiles)];
    }

    public async getSymbolCode(file: string, startLine: number, endLine: number): Promise<string> {
        const resolved = resolveWorkspaceUri(file);
        if (!resolved) return '';
        const { uri } = resolved;
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const start = new vscode.Position(startLine, 0);
            const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
            return document.getText(new vscode.Range(start, end));
        } catch (e) {
            logWarn(`Error getting symbol code for ${file}:${startLine}-${endLine}: ${e instanceof Error ? e.message : String(e)}`);
            return '';
        }
    }
}
