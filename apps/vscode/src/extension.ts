import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { EngineTransport } from './transport.js';
import { showVerifyPanel, type VerifyReport } from './views/verifyView.js';
import { showFilmPanel, type FilmReportView } from './views/filmView.js';
import { TaskProgressProvider } from './views/taskProgressView.js';

let transport: EngineTransport | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Junub Agent');
  context.subscriptions.push(outputChannel);

  const enginePath = context.asAbsolutePath('../../src/engine.mjs');
  transport = new EngineTransport(enginePath, outputChannel);

  // Progress tree view
  const progressProvider = new TaskProgressProvider();
  const treeView = vscode.window.createTreeView('junubAgentTaskProgress', {
    treeDataProvider: progressProvider,
  });
  context.subscriptions.push(treeView);

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

  // ---------------------------------------------------------------------
  // Command: Inspect Workspace
  // ---------------------------------------------------------------------
  const inspectCmd = vscode.commands.registerCommand('junubAgent.inspectWorkspace', async () => {
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage('Junub Agent engine is not running. Reload the window to restart it.');
      return;
    }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    outputChannel.show(true);
    outputChannel.appendLine(`[UI] Requesting inspection for: ${targetPath}`);
    try {
      const report = await client.request('pack.software.inspect', { path: targetPath });
      const src = report?.inventory?.source?.length ?? 0;
      const tst = report?.inventory?.tests?.length ?? 0;
      vscode.window.showInformationMessage(`Junub Agent: ${src} source, ${tst} test files.`);
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message);
    }
  });

  // ---------------------------------------------------------------------
  // Command: Verify Workspace
  // ---------------------------------------------------------------------
  const verifyCmd = vscode.commands.registerCommand('junubAgent.verifyWorkspace', async () => {
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage('Junub Agent engine is not running. Reload the window to restart it.');
      return;
    }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = (await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Verifying...' },
        () => client.request('pack.software.verify', { path: targetPath }),
      )) as VerifyReport;
      showVerifyPanel(report);
    } catch (e: any) {
      vscode.window.showErrorMessage(e.message);
    }
  });

  // ---------------------------------------------------------------------
  // Command: Run Task
  // ---------------------------------------------------------------------
  const runTaskCmd = vscode.commands.registerCommand('junubAgent.runTask', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'Task Contracts': ['json'] },
    });
    if (!uris || uris.length === 0) return;
    const selectedUri = uris[0];
    if (!selectedUri) return;

    try {
      const content = fs.readFileSync(selectedUri.fsPath, 'utf8');
      const contract = JSON.parse(content);
      outputChannel.show(true);
      const res = await transport!.request('task.run', { contract });
      vscode.window.showInformationMessage(`Task accepted: ${res.taskId}`);
      vscode.commands.executeCommand('junubAgentTaskProgress.focus');
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to run task: ${e.message}`);
    }
  });

  // ---------------------------------------------------------------------
  // Command: Inspect Film Project
  // ---------------------------------------------------------------------
  const inspectFilmCmd = vscode.commands.registerCommand('junubAgent.inspectFilmProject', async () => {
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage('Junub Agent engine is not running. Reload the window to restart it.');
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Inspect Film Project',
    });
    const selectedUri = uris && uris[0];
    if (!selectedUri) return;
    const targetPath = selectedUri.fsPath;

    outputChannel.show(true);
    outputChannel.appendLine(`[UI] Inspecting film project: ${targetPath}`);

    try {
      const [inspectResult, verifyResult] = (await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Junub Agent: inspecting film project',
          cancellable: false,
        },
        async () => {
          const insp = await client.request('pack.film.inspect', { path: targetPath });
          const ver = await client.request('pack.film.verify', { path: targetPath });
          return [insp, ver];
        },
      )) as [any, any];

      const report: FilmReportView = {
        root: inspectResult.root,
        projectType: inspectResult.project.projectType,
        scriptsCount: inspectResult.project.scripts.length,
        timelinesCount: inspectResult.project.timelines.length,
        mediaCount: inspectResult.project.mediaAssets.length,
        projectFilesCount: inspectResult.project.projectFiles.length,
        timelines: inspectResult.timelines,
        checks: verifyResult.checks,
        passed: verifyResult.passed,
      };

      outputChannel.appendLine('[UI] Film inspection complete.');
      outputChannel.appendLine(JSON.stringify(report, null, 2));

      showFilmPanel(report);

      const missingCount = report.checks.filter((c) => c.status === 'missing').length;
      const message =
        missingCount > 0
          ? `Junub Agent: ${missingCount} media file(s) missing.`
          : 'Junub Agent: all media linked.';
      vscode.window.showInformationMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[UI] Film inspection failed: ${message}`);
      vscode.window.showErrorMessage(`Junub Agent film inspection failed: ${message}`);
    }
  });

  context.subscriptions.push(inspectCmd, verifyCmd, runTaskCmd, inspectFilmCmd);
  outputChannel.appendLine('[UI] Junub Agent extension activated.');
}

export function deactivate(): void {
  if (transport) {
    transport.dispose();
    transport = undefined;
  }
}
