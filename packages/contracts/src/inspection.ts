export interface InventorySummary {
  readonly total: number;
  readonly limited: boolean;
  readonly source: readonly string[];
  readonly tests: readonly string[];
  readonly extensions: Record<string, number>;
}

export interface PackageManifestSummary {
  readonly name: string | null;
  readonly scripts: Record<string, string>;
}

export interface GitInspectionState {
  readonly available: boolean;
  readonly dirty: boolean | null;
  readonly changedPaths: readonly string[];
  readonly partial: boolean;
}

export interface InspectionReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly generatedAt: string;
  readonly inventory: InventorySummary;
  readonly package: PackageManifestSummary | null;
  readonly git: GitInspectionState;
  readonly observations: readonly string[];
}

export type CheckStatus = 'passed' | 'failed' | 'timed_out' | 'tool_error';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly exitCode: number | null;
  readonly error: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface VerificationReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly checks: readonly CheckResult[];
}
