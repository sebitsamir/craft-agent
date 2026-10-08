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

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let historyPath = workspaceFolder ? path.join(workspaceFolder, '.junub', 'history.jsonl') : null;

  if (!historyPath || !fs.existsSync(historyPath)) {
    historyPath = 'c:\\Users\\pc\\Desktop\\Projects\\junub-agent\\.junub\\history.jsonl';
  }

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
      .reverse();
  }

  // Group records by taskId
  const grouped = new Map<string, any[]>();
  for (const record of historyRecords) {
    const id = record.taskId || 'unknown';
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(record);
  }

  const tasksHtml = Array.from(grouped.entries()).map(([taskId, records], index) => {
    const planRecord = records.find(r => r.event === 'plan_generated');
    const execRecord = records.find(r => r.event === 'task_completed' || r.event === 'task_failed');
    const contract = planRecord?.contract || execRecord?.contract || {};
    const status = execRecord?.status || (planRecord ? 'planned' : 'unknown');
    const modelUsed = planRecord?.modelUsed || 'unknown';
    const timestamp = planRecord?.timestamp || execRecord?.timestamp || '';

    const statusClass = status === 'succeeded' ? 'status-ok' : status === 'failed' ? 'status-fail' : 'status-plan';
    const statusLabel = status === 'succeeded' ? 'Succeeded' : status === 'failed' ? 'Failed' : status === 'planned' ? 'Planned (not executed)' : 'Unknown';

    // Build steps HTML
    let stepsHtml = '';
    if (planRecord?.plan && Array.isArray(planRecord.plan)) {
      stepsHtml = planRecord.plan.map((step: any, si: number) => {
        const patchHtml = step.proposedPatch
          ? '<div class="patch-label">Proposed Patch:</div><pre class="patch-code">' + escapeHtml(JSON.stringify(step.proposedPatch, null, 2)) + '</pre>'
          : '';
        const sourcesHtml = step.sources && step.sources.length > 0
          ? '<div class="sources">Sources: ' + step.sources.map((s: any) => '<code>' + escapeHtml(s.uri) + '</code>').join(', ') + '</div>'
          : '';
        return '<div class="step-card">' +
          '<div class="step-header"><span class="step-num">' + (si + 1) + '</span>' +
          '<span class="step-action">' + escapeHtml(step.action || '') + '</span>' +
          '<span class="step-id">' + escapeHtml(step.stepId || '') + '</span></div>' +
          '<div class="step-desc">' + escapeHtml(step.description || '') + '</div>' +
          sourcesHtml + patchHtml +
          '</div>';
      }).join('');
    } else if (planRecord?.refusal) {
      stepsHtml = '<div class="refusal-box">' +
        '<strong>Model Refused to Plan</strong><br>' +
        'Reason: ' + escapeHtml(planRecord.refusal.reason || '') + '<br>' +
        'Message: ' + escapeHtml(planRecord.refusal.message || '') + '<br>' +
        'Suggested: ' + escapeHtml(planRecord.refusal.suggestedNextAction || '') +
        '</div>';
    }

    // Build execution HTML
    let execHtml = '';
    if (execRecord) {
      if (execRecord.executedSteps && Array.isArray(execRecord.executedSteps)) {
        execHtml = '<div class="exec-section"><h3>Executed Steps</h3>' +
          execRecord.executedSteps.map((es: any) =>
            '<div class="exec-step"><span class="exec-kind">' + escapeHtml(es.kind || '') + '</span> ' + escapeHtml(es.statement || es.stepId || '') + '</div>'
          ).join('') + '</div>';
      }
      if (execRecord.error) {
        execHtml += '<div class="error-box">Error: ' + escapeHtml(execRecord.error) + '</div>';
      }
    }

    return '<div class="task-group">' +
      '<div class="task-header" onclick="toggleDetail(' + index + ')">' +
        '<span class="expand-icon" id="icon-' + index + '">&#9654;</span>' +
        '<span class="task-title">' + escapeHtml(contract.title || taskId) + '</span>' +
        '<span class="badge ' + statusClass + '">' + statusLabel + '</span>' +
        '<span class="task-time">' + new Date(timestamp).toLocaleString() + '</span>' +
      '</div>' +
      '<div class="task-detail" id="detail-' + index + '" style="display:none;">' +
        '<div class="meta">Task ID: <code>' + escapeHtml(taskId) + '</code> | Model: <code>' + escapeHtml(modelUsed) + '</code> | Domain: ' + escapeHtml(contract.domain || 'unknown') + '</div>' +
        '<div class="intent">Intent: ' + escapeHtml(contract.intent || '') + '</div>' +
        (stepsHtml ? '<h3>Plan Steps (' + (planRecord?.plan?.length || 0) + ')</h3>' + stepsHtml : '') +
        execHtml +
      '</div>' +
    '</div>';
  }).join('');

  panel.webview.html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>Task History</title>\n<style>\n' +
    'body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }\n' +
    'h1 { margin-top: 0; }\n' +
    'h3 { margin-top: 16px; margin-bottom: 8px; color: var(--vscode-textLink-foreground); }\n' +
    '.task-group { border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin-bottom: 12px; overflow: hidden; }\n' +
    '.task-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; background: var(--vscode-editorWidget-background); }\n' +
    '.task-header:hover { background: var(--vscode-list-hoverBackground); }\n' +
    '.expand-icon { font-size: 10px; transition: transform 0.2s; width: 14px; }\n' +
    '.task-title { font-weight: bold; flex-grow: 1; }\n' +
    '.badge { padding: 2px 10px; border-radius: 10px; font-size: 0.8em; font-weight: bold; }\n' +
    '.status-ok { background: var(--vscode-testing-iconPassed); color: #fff; }\n' +
    '.status-fail { background: var(--vscode-testing-iconFailed); color: #fff; }\n' +
    '.status-plan { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }\n' +
    '.task-time { font-size: 0.85em; color: var(--vscode-descriptionForeground); }\n' +
    '.task-detail { padding: 16px; border-top: 1px solid var(--vscode-panel-border); }\n' +
    '.meta { font-size: 0.9em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }\n' +
    '.meta code { background: var(--vscode-textBlockQuote-background); padding: 1px 5px; border-radius: 3px; }\n' +
    '.intent { margin-bottom: 12px; }\n' +
    '.step-card { border: 1px solid var(--vscode-panel-border); padding: 12px; margin-bottom: 8px; border-radius: 4px; background: var(--vscode-editor-background); }\n' +
    '.step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }\n' +
    '.step-num { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: bold; }\n' +
    '.step-action { font-weight: bold; color: var(--vscode-textLink-foreground); }\n' +
    '.step-id { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-left: auto; }\n' +
    '.step-desc { margin-bottom: 6px; }\n' +
    '.sources { font-size: 0.85em; color: var(--vscode-descriptionForeground); }\n' +
    '.sources code { background: var(--vscode-textBlockQuote-background); padding: 1px 4px; border-radius: 2px; font-size: 0.9em; }\n' +
    '.patch-label { font-weight: bold; margin-top: 8px; margin-bottom: 4px; color: var(--vscode-textLink-foreground); }\n' +
    '.patch-code { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; font-size: 12px; font-family: var(--vscode-editor-font-family); white-space: pre-wrap; word-wrap: break-word; border-left: 3px solid var(--vscode-textLink-foreground); }\n' +
    '.exec-section { margin-top: 16px; }\n' +
    '.exec-step { padding: 4px 0; }\n' +
    '.exec-kind { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 3px; font-size: 0.8em; font-weight: bold; }\n' +
    '.refusal-box { background: var(--vscode-inputValidation-warningBackground); padding: 12px; border-radius: 4px; border: 1px solid var(--vscode-inputValidation-warningBorder); }\n' +
    '.error-box { background: var(--vscode-inputValidation-errorBackground); padding: 12px; border-radius: 4px; border: 1px solid var(--vscode-inputValidation-errorBorder); margin-top: 12px; }\n' +
    '.empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 40px; }\n' +
    '</style>\n</head>\n<body>\n<h1>Task History</h1>\n' +
    (tasksHtml || '<div class="empty">No task history found. Run a task to see it here.</div>') +
    '\n<script>\nfunction toggleDetail(i) {\n  var d = document.getElementById("detail-" + i);\n  var icon = document.getElementById("icon-" + i);\n  if (d.style.display === "none") { d.style.display = "block"; icon.innerHTML = "&#9660;"; }\n  else { d.style.display = "none"; icon.innerHTML = "&#9654;"; }\n}\n</script>\n</body>\n</html>';
}

function escapeHtml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
