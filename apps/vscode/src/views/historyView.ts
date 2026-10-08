import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function showHistoryPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'junubHistory',
    'Junub Agent: Task History',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  // Fallback to the known project root if the workspace folder is different
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const historyPath = workspaceFolder
    ? path.join(workspaceFolder, '.junub', 'history.jsonl')
    : 'c:\\Users\\pc\\Desktop\\Projects\\junub-agent\\.junub\\history.jsonl';

  let historyRecords: any[] = [];
  if (historyPath && fs.existsSync(historyPath)) {
    const content = fs.readFileSync(historyPath, 'utf8');
    historyRecords = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // Newest first
  }

  const rowsHtml = historyRecords.map((record: any) => {
    const statusColor = record.status === 'succeeded' ? 'var(--vscode-testing-iconPassed)' :
                        record.status === 'failed' ? 'var(--vscode-testing-iconFailed)' :
                        'var(--vscode-descriptionForeground)';
    const statusIcon = record.status === 'succeeded' ? 'check' :
                       record.status === 'failed' ? 'error' : 'clock';

    const details = record.event === 'plan_generated'
      ? `Planned ${record.planStepsCount || 0} steps using ${record.modelUsed || 'unknown'}`
      : `Execution ${record.status}`;

    return `
      <div class="history-item">
        <div class="header">
          <span class="icon"><span class="codicon codicon-${statusIcon}" style="color: ${statusColor}"></span></span>
          <span class="title">${escapeHtml(record.contract?.title || 'Unknown Task')}</span>
          <span class="time">${new Date(record.timestamp).toLocaleString()}</span>
        </div>
        <div class="details">${escapeHtml(details)}</div>
        ${record.error ? `<div class="error">Error: ${escapeHtml(record.error)}</div>` : ''}
      </div>
    `;
  }).join('');

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Task History</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { margin-top: 0; }
    .history-item { border: 1px solid var(--vscode-panel-border); padding: 12px; margin-bottom: 10px; border-radius: 4px; background: var(--vscode-editorWidget-background); }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .title { font-weight: bold; flex-grow: 1; }
    .time { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .details { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-testing-iconFailed); font-size: 0.9em; margin-top: 6px; font-family: var(--vscode-editor-font-family); }
    .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 40px; }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codicon/0.0.36/codicon.css">
</head>
<body>
  <h1>Task History</h1>
  ${historyRecords.length > 0 ? rowsHtml : '<div class="empty">No task history found. Run a task to see it here.</div>'}
</body>
</html>`;
}

function escapeHtml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
