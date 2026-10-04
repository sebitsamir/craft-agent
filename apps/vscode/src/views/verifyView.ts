import * as vscode from 'vscode';

/**
 * One check result from the software pack verifier.
 * Shape mirrors the seed verifier output so the UI stays decoupled.
 */
export interface VerifyCheck {
  readonly name: string;
  readonly status: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
  readonly error?: string | null;
  readonly truncated?: boolean;
}

/**
 * Full verification report from the software pack.
 */
export interface VerifyReport {
  readonly schemaVersion: number;
  readonly root: string;
  readonly generatedAt: string;
  readonly passed: boolean;
  readonly checks: readonly VerifyCheck[];
}

/**
 * Human-readable labels for each check status.
 * "skipped" is reserved for task-driven checks added in a later slice.
 */
const STATUS_LABELS: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  tool_error: 'Tool Error',
  timed_out: 'Timed Out',
  skipped: 'Skipped',
};

/**
 * Opens a read-only webview showing verification results with each check's
 * status clearly distinguished by color and label.
 */
export function showVerifyPanel(report: VerifyReport): void {
  const panel = vscode.window.createWebviewPanel(
    'junubAgentVerify',
    'Junub Agent: Verify Results',
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );
  panel.webview.html = renderReport(report);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderReport(report: VerifyReport): string {
  const rows = report.checks.map(renderCheckRow).join('\n');
  const overallClass = report.passed ? 'pass' : 'fail';
  const overallText = report.passed
    ? 'All checks passed'
    : 'One or more checks did not pass';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h1 { font-size: 1.2em; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 12px; }
  .summary { padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; font-weight: 600; }
  .summary.pass { background: rgba(63,185,80,0.15); color: #3fb950; }
  .summary.fail { background: rgba(248,81,73,0.15); color: #f85149; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border, #333); vertical-align: top; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.85em; font-weight: 600; color: #fff; }
  .badge.passed { background: #3fb950; }
  .badge.failed { background: #f85149; }
  .badge.tool_error { background: #d29922; }
  .badge.timed_out { background: #d29922; }
  .badge.skipped { background: #8b949e; }
  details { margin-top: 6px; }
  summary { cursor: pointer; color: var(--vscode-textLink-foreground, #3794ff); }
  pre { background: var(--vscode-textCodeBlock-background, #1e1e1e); padding: 8px; border-radius: 4px; overflow-x: auto; max-height: 200px; }
</style>
</head>
<body>
  <h1>Junub Agent — Verification Results</h1>
  <div class="meta">Root: ${escapeHtml(report.root)}<br>Generated: ${escapeHtml(report.generatedAt)}</div>
  <div class="summary ${overallClass}">${overallText}</div>
  <table>
    <thead>
      <tr><th>Check</th><th>Status</th><th>Details</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function renderCheckRow(check: VerifyCheck): string {
  const label = STATUS_LABELS[check.status] ?? check.status;

  const details: string[] = [];
  if (typeof check.exitCode === 'number') details.push(`exit code ${check.exitCode}`);
  if (check.timedOut) details.push('exceeded time bound');
  if (check.error) details.push(`error: ${check.error}`);
  if (check.truncated) details.push('output truncated');
  const detailText = details.length ? escapeHtml(details.join('; ')) : '&mdash;';

  const output = renderOutput(check);

  return `      <tr>
        <td>${escapeHtml(check.name)}</td>
        <td><span class="badge ${escapeHtml(check.status)}">${escapeHtml(label)}</span></td>
        <td>${detailText}${output}</td>
      </tr>`;
}

function renderOutput(check: VerifyCheck): string {
  const sections: string[] = [];
  if (check.stdout && check.stdout.trim()) {
    sections.push(`<details><summary>stdout</summary><pre>${escapeHtml(check.stdout)}</pre></details>`);
  }
  if (check.stderr && check.stderr.trim()) {
    sections.push(`<details><summary>stderr</summary><pre>${escapeHtml(check.stderr)}</pre></details>`);
  }
  return sections.length ? `\n          ${sections.join('\n          ')}` : '';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
