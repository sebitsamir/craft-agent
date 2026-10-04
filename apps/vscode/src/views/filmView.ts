import * as vscode from 'vscode';

/**
 * Minimal view of the film-pack inspection and verification results consumed
 * by the UI. The full schemas are owned by @junub-agent/pack-film; the
 * extension declares only the fields it renders so it stays decoupled.
 */
export interface FilmTimelineView {
  readonly path: string;
  readonly format: string;
  readonly referencedClips: readonly string[];
}

export interface FilmMediaCheckView {
  readonly timelinePath: string;
  readonly clipName: string;
  readonly status: 'linked' | 'missing';
}

export interface FilmReportView {
  readonly root: string;
  readonly projectType: string;
  readonly scriptsCount: number;
  readonly timelinesCount: number;
  readonly mediaCount: number;
  readonly projectFilesCount: number;
  readonly mediaAssets: readonly string[];
  readonly timelines: readonly FilmTimelineView[];
  readonly checks: readonly FilmMediaCheckView[];
  readonly passed: boolean;
}

/**
 * Opens a read-only webview showing the film project's anatomy and a
 * color-coded table of media links (linked vs missing/offline).
 */
export function showFilmPanel(report: FilmReportView): void {
  const panel = vscode.window.createWebviewPanel(
    'junubAgentFilm',
    'Junub Agent: Film Project',
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );
  panel.webview.html = renderFilmReport(report);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderFilmReport(report: FilmReportView): string {
  const timelineRows = report.timelines.map(renderTimelineRow).join('\n');
  const checkRows = report.checks.map(renderCheckRow).join('\n');

  const overallClass = report.passed ? 'pass' : 'fail';
  const overallText = report.passed
    ? 'All referenced media is linked.'
    : 'One or more referenced media files are missing (Media Offline).';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h1 { font-size: 1.2em; margin-bottom: 4px; }
  h2 { font-size: 1em; margin-top: 20px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 12px; }
  .summary { padding: 8px 12px; border-radius: 4px; margin: 12px 0; font-weight: 600; }
  .summary.pass { background: rgba(63,185,80,0.15); color: #3fb950; }
  .summary.fail { background: rgba(248,81,73,0.15); color: #f85149; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .card { background: var(--vscode-textCodeBlock-background, #1e1e1e); border-radius: 6px; padding: 10px 14px; min-width: 90px; }
  .card .num { font-size: 1.4em; font-weight: 700; }
  .card .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border, #333); vertical-align: top; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.85em; font-weight: 600; color: #fff; }
  .badge.linked { background: #3fb950; }
  .badge.missing { background: #f85149; }
  .timeline-format { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
</style>
</head>
<body>
  <h1>Junub Agent — Film Project</h1>
  <div class="meta">Root: ${escapeHtml(report.root)}<br>Type: ${escapeHtml(report.projectType)}</div>

  <div class="summary ${overallClass}">${overallText}</div>

  <div class="cards">
    <div class="card"><div class="num">${report.scriptsCount}</div><div class="label">Scripts</div></div>
    <div class="card"><div class="num">${report.timelinesCount}</div><div class="label">Timelines</div></div>
    <div class="card"><div class="num">${report.mediaCount}</div><div class="label">Media Assets</div></div>
    <div class="card"><div class="num">${report.projectFilesCount}</div><div class="label">Project Files</div></div>
  </div>

  <h2>Timelines</h2>
  <table>
    <thead><tr><th>Timeline</th><th>Format</th><th>Referenced Clips</th></tr></thead>
    <tbody>
${timelineRows}
    </tbody>
  </table>

  <h2>Media Links</h2>
  <table>
    <thead><tr><th>Clip</th><th>Timeline</th><th>Status</th></tr></thead>
    <tbody>
${checkRows}
    </tbody>
  </table>
</body>
</html>`;
}

function renderTimelineRow(timeline: FilmTimelineView): string {
  return `      <tr>
        <td>${escapeHtml(timeline.path)}</td>
        <td class="timeline-format">${escapeHtml(timeline.format)}</td>
        <td>${timeline.referencedClips.length}</td>
      </tr>`;
}

function renderCheckRow(check: FilmMediaCheckView): string {
  const label = check.status === 'linked' ? 'Linked' : 'Missing';
  return `      <tr>
        <td>${escapeHtml(check.clipName)}</td>
        <td>${escapeHtml(check.timelinePath)}</td>
        <td><span class="badge ${escapeHtml(check.status)}">${label}</span></td>
      </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
