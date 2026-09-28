import * as vscode from 'vscode';
import * as path from 'path';
import { logInfo, logWarn } from '../logger';
import { getWorkspaceFolders, normalizeFsPath } from '../workspaceUtils';

export interface IndexedFileEntry {
    relativePath: string;
    absolutePath: string;
    contentHash: string;
    lastModified: number;
    symbolCount: number;
    language: string;
    size: number;
}

export interface IndexChangeEvent {
    type: 'created' | 'changed' | 'deleted';
    file: string;
    timestamp: number;
}

export class IncrementalIndexer implements vscode.Disposable {
    private _onDidChange = new vscode.EventEmitter<IndexChangeEvent>();
    public readonly onDidChange = this._onDidChange.event;

    private _isInitialized = false;
    private _files = new Map<string, IndexedFileEntry>(); // map from relativePath to entry
    private _watchers: vscode.FileSystemWatcher[] = [];
    private _debouncedUpdates = new Map<string, NodeJS.Timeout>();

    private readonly DEFAULT_IGNORE = [
        'node_modules', 'vendor', 'dist', 'build', 'coverage', '.git',
        '__pycache__', '.next', '.nuxt', 'target', 'bin', 'obj', 'out',
        '.cache', '.parcel-cache'
    ];

    private readonly BINARY_EXTENSIONS = new Set([
        '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.zip', '.tar', '.gz',
        '.png', '.jpg', '.gif', '.mp3', '.mp4', '.pdf', '.woff', '.woff2', '.ttf',
        '.eot', '.ico', '.svg'
    ]);

    public async initialize(): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        logInfo('Initializing IncrementalIndexer...');
        const workspaceFolders = getWorkspaceFolders();
        
        for (const folder of workspaceFolders) {
            await this.scanWorkspace(folder);
            this.setupWatcher(folder);
        }

        this._isInitialized = true;
        logInfo(`IncrementalIndexer initialized. Indexed ${this._files.size} files.`);
    }

    private async scanWorkspace(folder: vscode.WorkspaceFolder): Promise<void> {
        const config = vscode.workspace.getConfiguration('hooshyar');
        const respectIgnore = config.get<boolean>('respectIgnoreFiles', true);
        const excludePattern = respectIgnore ? undefined : null; // use workspace default excludes or none

        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), excludePattern);
        
        const CHUNK_SIZE = 50;
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
            const chunk = files.slice(i, i + CHUNK_SIZE);
            await new Promise<void>(resolve => {
                setImmediate(async () => {
                    for (const uri of chunk) {
                        await this.indexFile(uri, folder);
                    }
                    resolve();
                });
            });
        }
    }

    private setupWatcher(folder: vscode.WorkspaceFolder): void {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
        
        watcher.onDidCreate(uri => this.handleFileEvent('created', uri, folder));
        watcher.onDidChange(uri => this.handleFileEvent('changed', uri, folder));
        watcher.onDidDelete(uri => this.handleFileEvent('deleted', uri, folder));
        
        this._watchers.push(watcher);
    }

    private handleFileEvent(type: 'created' | 'changed' | 'deleted', uri: vscode.Uri, folder: vscode.WorkspaceFolder) {
        const key = uri.fsPath;
        if (this._debouncedUpdates.has(key)) {
            clearTimeout(this._debouncedUpdates.get(key));
        }

        const timer = setTimeout(async () => {
            this._debouncedUpdates.delete(key);
            
            const absolutePath = normalizeFsPath(uri.fsPath);
            const folderPath = normalizeFsPath(folder.uri.fsPath);
            const rawRelativePath = path.relative(folderPath, absolutePath);
            const relativePath = normalizeFsPath(rawRelativePath);

            if (type === 'deleted') {
                if (this._files.has(relativePath)) {
                    this._files.delete(relativePath);
                    this._onDidChange.fire({ type, file: relativePath, timestamp: Date.now() });
                }
            } else {
                const changed = await this.indexFile(uri, folder);
                if (changed) {
                    this._onDidChange.fire({ type, file: relativePath, timestamp: Date.now() });
                }
            }
        }, 300);
        
        this._debouncedUpdates.set(key, timer);
    }

    private async indexFile(uri: vscode.Uri, folder: vscode.WorkspaceFolder): Promise<boolean> {
        const absolutePath = normalizeFsPath(uri.fsPath);
        const folderPath = normalizeFsPath(folder.uri.fsPath);
        const rawRelativePath = path.relative(folderPath, absolutePath);
        const relativePath = normalizeFsPath(rawRelativePath);

        if (this.shouldIgnore(relativePath)) {
            return false;
        }

        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
                return false;
            }

            if (stat.size > 1024 * 1024) { // 1MB
                return false;
            }

            const contentArray = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(contentArray).toString('utf-8');
            const contentHash = this.djb2Hash(content);

            const existing = this._files.get(relativePath);
            if (existing && existing.contentHash === contentHash) {
                return false; // Not changed
            }

            const symbolCount = this.estimateSymbolCount(content);
            const language = this.detectLanguage(relativePath);

            const entry: IndexedFileEntry = {
                relativePath,
                absolutePath,
                contentHash,
                lastModified: stat.mtime,
                symbolCount,
                language,
                size: stat.size
            };

            this._files.set(relativePath, entry);
            return true;
        } catch (error) {
            logWarn(`Failed to index file ${absolutePath}: ${error}`);
            return false;
        }
    }

    private shouldIgnore(relativePath: string): boolean {
        const parts = relativePath.split(/[/\\]/);
        for (const part of parts) {
            if (this.DEFAULT_IGNORE.includes(part)) {
                return true;
            }
        }
        
        const ext = path.extname(relativePath).toLowerCase();
        if (this.BINARY_EXTENSIONS.has(ext)) {
            return true;
        }

        return false;
    }

    private djb2Hash(str: string): string {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }

    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string> = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.rb': 'ruby',
            '.php': 'php',
            '.cs': 'csharp',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.md': 'markdown'
        };
        return map[ext] || 'plaintext';
    }

    private estimateSymbolCount(content: string): number {
        // Very basic heuristic for symbols
        const match = content.match(/(function |class |const .* = \(|interface |type )/g);
        return match ? match.length : 0;
    }

    public getIndexedFiles(): IndexedFileEntry[] {
        return Array.from(this._files.values());
    }

    public getFile(relativePath: string): IndexedFileEntry | undefined {
        return this._files.get(relativePath);
    }

    public isFileIndexed(relativePath: string): boolean {
        return this._files.has(relativePath);
    }

    public getChangedFilesSince(timestamp: number): IndexedFileEntry[] {
        const changed: IndexedFileEntry[] = [];
        for (const entry of this._files.values()) {
            if (entry.lastModified >= timestamp) {
                changed.push(entry);
            }
        }
        return changed;
    }

    public getFilesByLanguage(language: string): IndexedFileEntry[] {
        const result: IndexedFileEntry[] = [];
        for (const entry of this._files.values()) {
            if (entry.language === language) {
                result.push(entry);
            }
        }
        return result;
    }

    public getProjectMap(maxDepth: number = 4): string {
        interface TreeNode {
            name: string;
            children: Map<string, TreeNode>;
            entry?: IndexedFileEntry;
        }

        const root: TreeNode = { name: 'root', children: new Map() };

        for (const [relPath, entry] of this._files) {
            const parts = relPath.split('/');
            let current = root;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!current.children.has(part)) {
                    current.children.set(part, { name: part, children: new Map() });
                }
                current = current.children.get(part)!;
                if (i === parts.length - 1) {
                    current.entry = entry;
                }
            }
        }

        let result = '';

        const traverse = (node: TreeNode, depth: number, currentDepth: number) => {
            if (currentDepth > depth) return;
            
            const indent = '  '.repeat(currentDepth);
            
            // Sort folders first, then files
            const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
                const aIsFile = !!a.entry;
                const bIsFile = !!b.entry;
                if (aIsFile && !bIsFile) return 1;
                if (!aIsFile && bIsFile) return -1;
                return a.name.localeCompare(b.name);
            });

            for (const child of sortedChildren) {
                if (child.entry) {
                    const symbolText = child.entry.symbolCount > 0 ? ` (${child.entry.symbolCount} symbols)` : '';
                    result += `${indent}${child.name}${symbolText}\n`;
                } else {
                    result += `${indent}${child.name}/\n`;
                    traverse(child, depth, currentDepth + 1);
                }
            }
        };

        // Output tree from the root's children, not the synthetic 'root' itself
        for (const child of Array.from(root.children.values()).sort((a, b) => {
            const aIsFile = !!a.entry;
            const bIsFile = !!b.entry;
            if (aIsFile && !bIsFile) return 1;
            if (!aIsFile && bIsFile) return -1;
            return a.name.localeCompare(b.name);
        })) {
            if (child.entry) {
                const symbolText = child.entry.symbolCount > 0 ? ` (${child.entry.symbolCount} symbols)` : '';
                result += `${child.name}${symbolText}\n`;
            } else {
                result += `${child.name}/\n`;
                traverse(child, maxDepth, 1);
            }
        }

        return result.trim();
    }

    public dispose() {
        this._onDidChange.dispose();
        this._watchers.forEach(w => w.dispose());
        this._debouncedUpdates.forEach(t => clearTimeout(t));
        this._debouncedUpdates.clear();
        this._files.clear();
    }
}

let instance: IncrementalIndexer | undefined;

export function getIncrementalIndexer(): IncrementalIndexer {
    if (!instance) {
        instance = new IncrementalIndexer();
    }
    return instance;
}
