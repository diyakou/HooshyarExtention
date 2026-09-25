export interface ProjectProfile {
  languages: { name: string; percentage: number }[];
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  packageManager?: string;
  conventions: {
    indentation: 'spaces' | 'tabs';
    spacing: number;
    quotes: 'single' | 'double';
    naming: {
      classes: string;
      functions: string;
      variables: string;
    };
  };
  dependencies: {
    runtime: { name: string; version: string }[];
    dev: { name: string; version: string }[];
  };
  architecture: {
    directories: { path: string; purpose: string }[];
    patterns: string[];
  };
  metadata: {
    name?: string;
    version?: string;
    lastAnalyzed: number;
  };
}

export interface TechStackDetectionResult {
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  packageManager?: string;
  confidence: number;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer';
  source: string;
}

export interface CodingConventions {
  indentation: 'spaces' | 'tabs';
  spacing: number;
  quotes: 'single' | 'double';
  naming: {
    classes: string;
    functions: string;
    variables: string;
  };
  confidence: number;
}
