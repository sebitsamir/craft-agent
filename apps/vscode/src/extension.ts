import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { EngineTransport } from './transport.js';
import { showVerifyPanel, type VerifyReport } from './views/verifyView.js';
import { TaskProgressProvider } from './views/taskProgressView.js';

let transport: EngineTransport | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Craft Agent');
  context.subscriptions.push(outputChannel);

  const enginePath = context.asAbsolutePath('../../src/engine.mjs');
  transport = new EngineTransport(enginePath, outputChannel);

  // 1. Setup Progress Tree View
  const progressProvider = new TaskProgressProvider();
  const treeView = vscode.window.createTreeView('craftAgentTaskProgress', { treeDataProvider: progressProvider });
  context.subscriptions.push(treeView);

  // 2. Wire Protocol Events to the Tree View
  transport.onProtocolEvent((evt) => {
    if (evt.type === 'task.created') {
      progressProvider.reset();
    } else if (evt.type.startsWith('step.')) {
      const stepId = evt.payload.stepId;
      const status = evt.type.split('.')[1];
      const mappedStatus = status === 'started' ? 'running' : status;
      progressProvider.updateStep(stepId, mappedStatus, evt.payload.statement);
    }
  });

  // 3. Commands
  const inspectCmd = vscode.commands.registerCommand('craftAgent.inspectWorkspace', async () => {
    // ... (Keep existing inspect logic from Slice 2) ...
    const client = transport;
    if (!client) return vscode.window.showErrorMessage('Engine not running');
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = await client.request('pack.software.inspect', { path: targetPath });
      const src = report?.inventory?.source?.length ?? 0;
      const tst = report?.inventory?.tests?.length ?? 0;
      vscode.window.showInformationMessage(`Craft Agent: ${src} source, ${tst} test files.`);
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });

  const verifyCmd = vscode.commands.registerCommand('craftAgent.verifyWorkspace', async () => {
    // ... (Keep existing verify logic from Slice 2) ...
    const client = transport;
    if (!client) return vscode.window.showErrorMessage('Engine not running');
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Verifying...' },
        () => client.request('pack.software.verify', { path: targetPath })
      ) as VerifyReport;
      showVerifyPanel(report);
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });
  const runTaskCmd = vscode.commands.registerCommand('craftAgent.runTask', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Task Contracts': ['json'] },
    });

    // Guard against cancellation or empty selection.
    if (!uris || uris.length === 0) return;

    // Capture the first selection and guard it explicitly so TypeScript
    // narrows the type from Uri | undefined to Uri.
    const selectedUri = uris[0];
    if (!selectedUri) return;

    try {
      const content = fs.readFileSync(selectedUri.fsPath, 'utf8');
      const contract = JSON.parse(content);

      outputChannel.show(true);
      const res = await transport!.request('task.run', { contract });
      vscode.window.showInformationMessage(`Task accepted: ${res.taskId}`);

      // Focus the progress view.
      vscode.commands.executeCommand('craftAgentTaskProgress.focus');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to run task: ${e.message}`);
    }
  });

  context.subscriptions.push(inspectCmd, verifyCmd, runTaskCmd);
}

export function deactivate(): void {
  if (transport) { transport.dispose(); transport = undefined; }
}
