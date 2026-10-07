import * as vscode from 'vscode';

export interface PlanReviewResult {
  approved: boolean;
}

export function showPlanReviewPanel(
  context: vscode.ExtensionContext,
  plan: any,
  contract: any,
): Promise<PlanReviewResult> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'junubPlanReview',
      'Junub Agent: Review Plan',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const isRefusal = !plan.steps;

    const stepsHtml = isRefusal ? '' : (plan.steps || []).map((step: any) => {
      const patchHtml = step.proposedPatch
        ? `<div class="patch"><strong>Proposed Patch:</strong><pre>${escapeHtml(JSON.stringify(step.proposedPatch, null, 2))}</pre></div>`
        : '';
      return `
        <div class="step">
          <h3>${escapeHtml(step.stepId)}: ${escapeHtml(step.action)}</h3>
          <p>${escapeHtml(step.description)}</p>
          ${patchHtml}
        </div>
      `;
    }).join('');

    const refusalHtml = isRefusal ? `
      <div class="refusal">
        <h2>Model Refused to Plan</h2>
        <p><strong>Reason:</strong> ${escapeHtml(plan.reason || 'Unknown')}</p>
        <p><strong>Message:</strong> ${escapeHtml(plan.message || 'No details provided.')}</p>
        <p><strong>Suggested Next Action:</strong> ${escapeHtml(plan.suggestedNextAction || 'Review task constraints.')}</p>
      </div>
    ` : '';

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Review Plan</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { color: var(--vscode-editor-foreground); }
    h2 { margin-top: 20px; }
    .step { border: 1px solid var(--vscode-panel-border); padding: 15px; margin-bottom: 15px; border-radius: 4px; background: var(--vscode-editorWidget-background); }
    .step h3 { margin-top: 0; color: var(--vscode-textLink-foreground); }
    .patch { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; margin-top: 10px; border-left: 3px solid var(--vscode-textLink-foreground); }
    pre { white-space: pre-wrap; word-wrap: break-word; font-size: 12px; font-family: var(--vscode-editor-font-family); }
    .actions { margin-top: 30px; display: flex; gap: 10px; position: sticky; bottom: 0; background: var(--vscode-editor-background); padding: 15px 0; border-top: 1px solid var(--vscode-panel-border); }
    button { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; }
    .approve { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .approve:hover { background: var(--vscode-button-hoverBackground); }
    .reject { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .reject:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .refusal { background: var(--vscode-inputValidation-warningBackground); padding: 15px; border-radius: 4px; color: var(--vscode-inputValidation-warningForeground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
  </style>
</head>
<body>
  <h1>Review Execution Plan</h1>
  <p><strong>Task:</strong> ${escapeHtml(contract.title || 'Unknown')}</p>
  <p><strong>Intent:</strong> ${escapeHtml(contract.intent || 'Unknown')}</p>

  ${isRefusal ? refusalHtml : `
    <h2>Proposed Steps (${plan.steps.length})</h2>
    ${stepsHtml}
  `}

  <div class="actions">
    ${!isRefusal ? `<button class="approve" id="approveBtn">Approve & Execute</button>` : ''}
    <button class="reject" id="rejectBtn">${isRefusal ? 'Close' : 'Reject'}</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const approveBtn = document.getElementById('approveBtn');
    const rejectBtn = document.getElementById('rejectBtn');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'approve' });
      });
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'reject' });
      });
    }
  </script>
</body>
</html>`;

    let resolved = false;
    panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'approve') {
          resolved = true;
          resolve({ approved: true });
          panel.dispose();
        } else if (message.command === 'reject') {
          resolved = true;
          resolve({ approved: false });
          panel.dispose();
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(
      () => {
        if (!resolved) resolve({ approved: false });
      },
      undefined,
      context.subscriptions
    );
  });
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
