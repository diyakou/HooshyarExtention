import * as vscode from "vscode";
import { CodingConventions } from "./types";

export async function extractConventions(rootPath: string): Promise<CodingConventions> {
  const files = await vscode.workspace.findFiles("**/*.{ts,tsx,js,jsx,py,java,go,rs}", "**/node_modules/**", 100);

  if (files.length === 0) {
    return getDefaultConventions();
  }

  const samples = await Promise.all(
    files.slice(0, 20).map(async (uri) => {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(content).toString("utf-8");
      } catch {
        return "";
      }
    })
  );

  const validSamples = samples.filter(s => s.length > 0);
  if (validSamples.length === 0) {
    return getDefaultConventions();
  }

  return {
    indentation: detectIndentation(validSamples),
    spacing: detectSpacing(validSamples),
    quotes: detectQuotes(validSamples),
    naming: detectNaming(validSamples),
    confidence: Math.min(0.9, validSamples.length / 20)
  };
}

function detectIndentation(samples: string[]): 'spaces' | 'tabs' {
  let spacesCount = 0;
  let tabsCount = 0;

  for (const sample of samples) {
    const lines = sample.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith("  ") && !line.startsWith("   ")) spacesCount++;
      if (line.startsWith("\t")) tabsCount++;
    }
  }

  return spacesCount > tabsCount ? 'spaces' : 'tabs';
}

function detectSpacing(samples: string[]): number {
  const spaceCounts = new Map<number, number>();

  for (const sample of samples) {
    const lines = sample.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^( +)/);
      if (match) {
        const spaces = match[1].length;
        if (spaces >= 2 && spaces <= 8) {
          spaceCounts.set(spaces, (spaceCounts.get(spaces) || 0) + 1);
        }
      }
    }
  }

  if (spaceCounts.size === 0) return 2;

  // Find most common spacing that's a multiple of 2
  const sorted = Array.from(spaceCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [spaces] of sorted) {
    if (spaces % 2 === 0) return spaces;
  }

  return 2;
}

function detectQuotes(samples: string[]): 'single' | 'double' {
  let singleCount = 0;
  let doubleCount = 0;

  for (const sample of samples) {
    // Count string literals
    const singleMatches = sample.match(/'[^']*'/g);
    const doubleMatches = sample.match(/"[^"]*"/g);

    if (singleMatches) singleCount += singleMatches.length;
    if (doubleMatches) doubleCount += doubleMatches.length;
  }

  return singleCount > doubleCount ? 'single' : 'double';
}

function detectNaming(samples: string[]): { classes: string; functions: string; variables: string } {
  let pascalCase = 0;
  let camelCase = 0;
  let snakeCase = 0;

  for (const sample of samples) {
    // Class detection (PascalCase)
    const classMatches = sample.match(/class\s+([A-Z][a-zA-Z0-9]*)/g);
    if (classMatches) pascalCase += classMatches.length;

    // Function detection (camelCase or snake_case)
    const functionMatches = sample.match(/function\s+([a-z_][a-zA-Z0-9_]*)/g);
    if (functionMatches) {
      for (const match of functionMatches) {
        const name = match.replace(/function\s+/, '');
        if (name.includes('_')) snakeCase++;
        else camelCase++;
      }
    }

    // Variable detection
    const varMatches = sample.match(/(?:const|let|var)\s+([a-z_][a-zA-Z0-9_]*)/g);
    if (varMatches) {
      for (const match of varMatches) {
        const name = match.replace(/(?:const|let|var)\s+/, '');
        if (name.includes('_')) snakeCase++;
        else camelCase++;
      }
    }
  }

  const usesSnakeCase = snakeCase > camelCase;

  return {
    classes: "PascalCase",
    functions: usesSnakeCase ? "snake_case" : "camelCase",
    variables: usesSnakeCase ? "snake_case" : "camelCase"
  };
}

function getDefaultConventions(): CodingConventions {
  return {
    indentation: 'spaces',
    spacing: 2,
    quotes: 'double',
    naming: {
      classes: "PascalCase",
      functions: "camelCase",
      variables: "camelCase"
    },
    confidence: 0.1
  };
}
