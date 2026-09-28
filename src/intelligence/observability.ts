import * as vscode from 'vscode';
import { logDebug } from '../logger';

export interface MetricEntry {
    name: string;
    value: number;
    unit: 'ms' | 'count' | 'bytes' | 'tokens' | 'percent';
    timestamp: number;
    tags?: Record<string, string>;
}

export interface OperationTrace {
    operation: string;
    startTime: number;
    endTime?: number;
    durationMs?: number;
    details: Record<string, any>;
    children: OperationTrace[];
}

export class IntelligenceObserver {
    private static instance: IntelligenceObserver;
    private metrics: MetricEntry[] = [];
    private traces: OperationTrace[] = [];
    
    private readonly MAX_METRICS = 1000;
    private readonly MAX_TRACES = 100;

    private constructor() {}

    public static getObserver(): IntelligenceObserver {
        if (!IntelligenceObserver.instance) {
            IntelligenceObserver.instance = new IntelligenceObserver();
        }
        return IntelligenceObserver.instance;
    }

    public startTrace(operation: string, details: Record<string, any> = {}): OperationTrace {
        return {
            operation,
            startTime: Date.now(),
            details,
            children: []
        };
    }

    public endTrace(trace: OperationTrace): void {
        trace.endTime = Date.now();
        trace.durationMs = trace.endTime - trace.startTime;
        
        this.traces.push(trace);
        if (this.traces.length > this.MAX_TRACES) {
            this.traces.shift();
        }

        if (this.isEnabled()) {
            logDebug(`Trace ended: ${trace.operation} (${trace.durationMs}ms) Details: ${JSON.stringify(trace.details)}`);
        }
    }

    public recordMetric(name: string, value: number, unit: MetricEntry['unit'], tags?: Record<string, string>): void {
        const metric: MetricEntry = {
            name,
            value,
            unit,
            timestamp: Date.now(),
            tags
        };

        this.metrics.push(metric);
        if (this.metrics.length > this.MAX_METRICS) {
            this.metrics.shift();
        }

        if (this.isEnabled()) {
            let logMsg = `Metric: ${name} = ${value}${unit === 'count' ? '' : unit}`;
            if (tags) {
                logMsg += ` [${Object.entries(tags).map(([k, v]) => `${k}:${v}`).join(', ')}]`;
            }
            logDebug(logMsg);
        }
    }

    public getMetrics(name?: string, since?: number): MetricEntry[] {
        return this.metrics.filter(m => {
            if (name && m.name !== name) {
                return false;
            }
            if (since !== undefined && m.timestamp < since) {
                return false;
            }
            return true;
        });
    }

    public getRecentTraces(count: number = 10): OperationTrace[] {
        return this.traces.slice(-Math.min(count, this.traces.length));
    }

    public formatSummary(): string {
        const traces = this.getRecentTraces(5);
        let summary = 'Intelligence Observability Summary:\n';
        summary += `Metrics tracked: ${this.metrics.length}/${this.MAX_METRICS}\n`;
        summary += `Traces tracked: ${this.traces.length}/${this.MAX_TRACES}\n`;
        
        if (traces.length > 0) {
            summary += '\nRecent Traces:\n';
            for (const trace of traces) {
                summary += `  - ${trace.operation}: ${trace.durationMs}ms\n`;
            }
        }
        
        return summary;
    }

    public isEnabled(): boolean {
        return vscode.workspace.getConfiguration('hooshyar').get<boolean>('debugLogging', false);
    }

    public reset(): void {
        this.metrics = [];
        this.traces = [];
    }
}
