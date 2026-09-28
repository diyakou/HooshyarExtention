import * as vscode from 'vscode';
import { logDebug, logInfo, logWarn } from '../logger';
import { SymbolRef } from './codebaseIntelligence';

export interface DiagnosticItem {
    file: string;
    line: number;
    character: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
    source: string;
    code?: string | number;
}

export interface ValidationResult {
    success: boolean;
    errors: DiagnosticItem[];
    warnings: DiagnosticItem[];
    filesChecked: string[];
    iterationCount: number;
    repairAttempted: boolean;
}

export interface ImpactAnalysis {
    callers: SymbolRef[];
    references: SymbolRef[];
    implementations: SymbolRef[];
    tests: string[];
    isPublicApi: boolean;
    breakingChangeRisk: 'low' | 'medium' | 'high';
}

export class ValidationEngine {
    private maxRepairIterations: number;

    constructor(maxRepairIterations: number = 3) {
        this.maxRepairIterations = maxRepairIterations;
    }

    public async validateFiles(files: string[]): Promise<ValidationResult> {
        logInfo(`Validating files: ${files.join(', ')}`);
        const errors: DiagnosticItem[] = [];
        const warnings: DiagnosticItem[] = [];

        for (const file of files) {
            const diags = await this.getDiagnosticsForFile(file);
            for (const diag of diags) {
                if (diag.severity === 'error') {
                    errors.push(diag);
                } else if (diag.severity === 'warning') {
                    warnings.push(diag);
                }
            }
        }

        return {
            success: errors.length === 0,
            errors,
            warnings,
            filesChecked: files,
            iterationCount: 1,
            repairAttempted: false
        };
    }

    public async validateChangedFiles(): Promise<ValidationResult> {
        logInfo('Validating changed files');
        // A full implementation would check Git or VS Code scm API for changed files.
        // For now, this is a stub.
        return this.validateFiles([]);
    }

    public async getDiagnosticsForFile(file: string): Promise<DiagnosticItem[]> {
        try {
            const uri = vscode.Uri.file(file);
            const vsDiagnostics = vscode.languages.getDiagnostics(uri);
            const result: DiagnosticItem[] = [];

            for (const diag of vsDiagnostics) {
                let severity: 'error' | 'warning' | 'info';
                if (diag.severity === vscode.DiagnosticSeverity.Error) {
                    severity = 'error';
                } else if (diag.severity === vscode.DiagnosticSeverity.Warning) {
                    severity = 'warning';
                } else if (diag.severity === vscode.DiagnosticSeverity.Information) {
                    severity = 'info';
                } else {
                    continue; // Skip hints
                }

                let code: string | number | undefined;
                if (typeof diag.code === 'string' || typeof diag.code === 'number') {
                    code = diag.code;
                } else if (diag.code && typeof diag.code === 'object') {
                    code = String(diag.code.value);
                }

                result.push({
                    file,
                    line: diag.range.start.line + 1,
                    character: diag.range.start.character + 1,
                    message: diag.message,
                    severity,
                    source: diag.source || 'unknown',
                    code
                });
            }

            return result;
        } catch (error) {
            logWarn(`Failed to get diagnostics for file ${file}: ${error}`);
            return [];
        }
    }

    public async getDiagnosticsForTask(files: string[], severity?: 'error' | 'warning'): Promise<DiagnosticItem[]> {
        const allDiagnostics: DiagnosticItem[] = [];
        for (const file of files) {
            const diags = await this.getDiagnosticsForFile(file);
            allDiagnostics.push(...diags);
        }

        if (severity) {
            return allDiagnostics.filter(d => d.severity === severity);
        }
        return allDiagnostics.filter(d => d.severity === 'error' || d.severity === 'warning');
    }

    public shouldRunTypecheck(files: string[]): boolean {
        let hasTsJs = false;
        let hasPy = false;

        for (const file of files) {
            if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
                hasTsJs = true;
            }
            if (file.endsWith('.py')) {
                hasPy = true;
            }
        }

        // Ideally check for workspace files (tsconfig.json, pyproject.toml, etc.)
        // Returning true for simplicity if extensions match.
        return hasTsJs || hasPy;
    }

    public formatDiagnosticsForLLM(diagnostics: DiagnosticItem[], maxItems: number = 15): string {
        const errors = diagnostics.filter(d => d.severity === 'error');
        const warnings = diagnostics.filter(d => d.severity === 'warning');
        
        let output = `## Diagnostics (${errors.length} error${errors.length !== 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''})\n\n`;
        
        const toFormat = diagnostics.slice(0, maxItems);
        
        for (const diag of toFormat) {
            const severityUpper = diag.severity.toUpperCase();
            const codePart = diag.code ? ` [${diag.source}(${diag.code})]` : (diag.source ? ` [${diag.source}]` : '');
            
            output += `${severityUpper} ${diag.file}:${diag.line}:${diag.character}\n`;
            output += `${diag.message}${codePart}\n\n`;
        }
        
        return output.trim();
    }

    public async analyzeImpact(file: string, symbolName: string): Promise<ImpactAnalysis> {
        logDebug(`Analyzing impact for ${symbolName} in ${file}`);
        
        // This is a stub implementation. A real implementation would use vscode executeReferenceProvider 
        // and workspace symbol search to find callers, references, and implementations.
        
        // Using fake data to demonstrate logic
        const callersCount = 0; 
        let breakingChangeRisk: 'low' | 'medium' | 'high' = 'low';
        
        if (callersCount > 5) {
            breakingChangeRisk = 'high';
        } else if (callersCount >= 2) {
            breakingChangeRisk = 'medium';
        }
        
        return {
            callers: [],
            references: [],
            implementations: [],
            tests: [],
            isPublicApi: false,
            breakingChangeRisk
        };
    }
}
