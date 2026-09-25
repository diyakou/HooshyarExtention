import { createHash } from "crypto";
import { IndexedChunk } from "./types";

export interface SymbolRange {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function chunkDocument(
  uri: string,
  languageId: string,
  content: string,
  symbols: SymbolRange[] = [],
  updatedAt = Date.now()
): IndexedChunk[] {
  const lines = content.split(/\r?\n/);
  const imports = extractMatches(content, /(?:import[^"']*from\s*|require\s*\(|from\s+)["']([^"']+)["']/g);
  const exports = extractMatches(content, /\bexport\s+(?:default\s+)?(?:class|function|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g);
  const ranges = symbols.length > 0 ? symbols : inferLogicalRanges(lines);
  const effectiveRanges = ranges.length > 0
    ? ranges
    : buildLineRanges(lines.length, 120, 20).map((range, index) => ({ ...range, name: `chunk_${index + 1}`, kind: "Block" }));

  return effectiveRanges
    .filter((range) => range.startLine >= 0 && range.endLine >= range.startLine)
    .map((range) => {
      const startLine = Math.min(range.startLine, Math.max(0, lines.length - 1));
      const endLine = Math.min(range.endLine, Math.max(0, lines.length - 1));
      const chunkContent = lines.slice(startLine, endLine + 1).join("\n");
      return {
        id: contentHash(`${uri}:${startLine}:${endLine}:${chunkContent}`),
        uri,
        languageId,
        symbolName: range.name,
        symbolKind: range.kind,
        startLine,
        endLine,
        content: chunkContent,
        imports,
        exports,
        hash: contentHash(chunkContent),
        updatedAt
      };
    });
}

function inferLogicalRanges(lines: string[]): SymbolRange[] {
  const starts: Array<{ line: number; name: string; kind: string }> = [];
  const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|interface|function|enum|type|const|let|var|def|struct|trait|impl)\s+([A-Za-z_$][\w$]*)/;
  lines.forEach((line, index) => {
    const match = line.match(declaration);
    if (match) starts.push({ line: index, kind: match[1], name: match[2] });
  });
  return starts.map((start, index) => ({
    name: start.name,
    kind: start.kind,
    startLine: start.line,
    endLine: Math.min(lines.length - 1, (starts[index + 1]?.line ?? lines.length) - 1)
  }));
}

function buildLineRanges(totalLines: number, size: number, overlap: number): Array<{ startLine: number; endLine: number }> {
  const ranges: Array<{ startLine: number; endLine: number }> = [];
  const step = Math.max(1, size - overlap);
  for (let startLine = 0; startLine < totalLines; startLine += step) {
    ranges.push({ startLine, endLine: Math.min(totalLines - 1, startLine + size - 1) });
  }
  return ranges;
}

function extractMatches(content: string, regex: RegExp): string[] {
  return [...content.matchAll(regex)].map((match) => match[1]).filter(Boolean);
}
