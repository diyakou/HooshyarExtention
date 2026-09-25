import { TestFramework } from "./testFrameworkDetector";

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  file?: string;
  line?: number;
}

export interface TestSuiteResult {
  framework: TestFramework;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
}

export class TestResultParser {
  parse(output: string, framework: TestFramework): TestSuiteResult {
    switch (framework) {
      case 'jest':
        return this.parseJest(output);
      case 'mocha':
        return this.parseMocha(output);
      case 'pytest':
        return this.parsePytest(output);
      case 'junit':
        return this.parseJUnit(output);
      case 'go-test':
        return this.parseGoTest(output);
      default:
        return this.parseGeneric(output);
    }
  }

  private parseJest(output: string): TestSuiteResult {
    const tests: TestResult[] = [];
    let totalTests = 0;
    let passed = 0;
    let failed = 0;
    const skipped = 0;
    let duration = 0;

    // Parse test summary
    const summaryMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (summaryMatch) {
      failed = parseInt(summaryMatch[1]);
      passed = parseInt(summaryMatch[2]);
      totalTests = parseInt(summaryMatch[3]);
    }

    // Parse individual test results
    const testRegex = /\s+(PASS|FAIL)\s+(.+?)\s+\((\d+\.?\d*)\s*ms\)/g;
    let match;
    while ((match = testRegex.exec(output)) !== null) {
      tests.push({
        name: match[2],
        status: match[1] === 'PASS' ? 'passed' : 'failed',
        duration: parseFloat(match[3])
      });
    }

    // Parse duration
    const durationMatch = output.match(/Time:\s+(\d+\.?\d*)\s*s/);
    if (durationMatch) {
      duration = parseFloat(durationMatch[1]) * 1000;
    }

    return {
      framework: 'jest',
      totalTests,
      passed,
      failed,
      skipped,
      duration,
      tests
    };
  }

  private parseMocha(output: string): TestSuiteResult {
    const tests: TestResult[] = [];
    let totalTests = 0;
    let passed = 0;
    let failed = 0;

    // Parse summary
    const summaryMatch = output.match(/(\d+)\s+passing/);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1]);
      totalTests += passed;
    }

    const failMatch = output.match(/(\d+)\s+failing/);
    if (failMatch) {
      failed = parseInt(failMatch[1]);
      totalTests += failed;
    }

    return {
      framework: 'mocha',
      totalTests,
      passed,
      failed,
      skipped: 0,
      duration: 0,
      tests
    };
  }

  private parsePytest(output: string): TestSuiteResult {
    const tests: TestResult[] = [];
    let totalTests = 0;
    let passed = 0;
    let failed = 0;

    // Parse summary line
    const summaryMatch = output.match(/(\d+)\s+passed(?:,\s+(\d+)\s+failed)?/);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1]);
      failed = summaryMatch[2] ? parseInt(summaryMatch[2]) : 0;
      totalTests = passed + failed;
    }

    return {
      framework: 'pytest',
      totalTests,
      passed,
      failed,
      skipped: 0,
      duration: 0,
      tests
    };
  }

  private parseJUnit(output: string): TestSuiteResult {
    const tests: TestResult[] = [];

    // Parse Maven/Gradle output
    const summaryMatch = output.match(/Tests run:\s+(\d+),\s+Failures:\s+(\d+),\s+Errors:\s+(\d+),\s+Skipped:\s+(\d+)/);

    if (summaryMatch) {
      const totalTests = parseInt(summaryMatch[1]);
      const failures = parseInt(summaryMatch[2]);
      const errors = parseInt(summaryMatch[3]);
      const skipped = parseInt(summaryMatch[4]);
      const passed = totalTests - failures - errors - skipped;

      return {
        framework: 'junit',
        totalTests,
        passed,
        failed: failures + errors,
        skipped,
        duration: 0,
        tests
      };
    }

    return this.parseGeneric(output);
  }

  private parseGoTest(output: string): TestSuiteResult {
    const tests: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    // Parse go test output
    const testRegex = /^(PASS|FAIL):\s+(.+)$/gm;
    let match;
    while ((match = testRegex.exec(output)) !== null) {
      const status = match[1] === 'PASS' ? 'passed' : 'failed';
      tests.push({
        name: match[2],
        status,
        duration: 0
      });

      if (status === 'passed') passed++;
      else failed++;
    }

    return {
      framework: 'go-test',
      totalTests: passed + failed,
      passed,
      failed,
      skipped: 0,
      duration: 0,
      tests
    };
  }

  private parseGeneric(output: string): TestSuiteResult {
    // Generic parser for unknown formats
    return {
      framework: 'unknown',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      tests: []
    };
  }
}
