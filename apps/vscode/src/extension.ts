import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { EngineTransport } from './transport.js';
import { showVerifyPanel, type VerifyReport } from './views/verifyView.js';
import { showFilmPanel, type FilmReportView } from './views/filmView.js';
import { FilmTreeProvider } from './views/filmTree.js';
import { TaskProgressProvider } from './views/taskProgressView.js';
import { showPlanReviewPanel } from './views/planReviewView.js';
import { showHistoryPanel } from './views/historyView.js';

let transport: EngineTransport | undefined;
let outputChannel: vscode.OutputChannel;

async function fetchFilmReport(client: EngineTransport, targetPath: string): Promise<FilmReportView> {
  const insp = await client.request('pack.film.inspect', { path: targetPath });
  const ver = await client.request('pack.film.verify', { path: targetPath });
  return {
    root: insp.root,
    projectType: insp.project.projectType,
    scriptsCount: insp.project.scripts.length,
    timelinesCount: insp.project.timelines.length,
    mediaCount: insp.project.mediaAssets.length,
    projectFilesCount: insp.project.projectFiles.length,
    mediaAssets: insp.project.mediaAssets,
    timelines: insp.timelines,
    checks: ver.checks,
    passed: ver.passed,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Junub Agent');
  context.subscriptions.push(outputChannel);

  const enginePath = context.asAbsolutePath('../../src/engine.mjs');

  const junubConfig = vscode.workspace.getConfiguration('junubAgent');
  const apiKey = junubConfig.get<string>('dashscopeApiKey');
  const baseUrl = junubConfig.get<string>('qwenBaseUrl');
  const model = junubConfig.get<string>('qwenModel');

  const extraEnv: Record<string, string> = {};
  if (apiKey && apiKey.trim()) {
    extraEnv.DASHSCOPE_API_KEY = apiKey.trim();
    if (baseUrl && baseUrl.trim()) extraEnv.QWEN_BASE_URL = baseUrl.trim();
    if (model && model.trim()) extraEnv.QWEN_MODEL = model.trim();
    outputChannel.appendLine('[UI] Qwen-compatible provider configured \u2014 base: ' + (baseUrl || 'DashScope default') + ', model: ' + (model || 'qwen-max'));
  } else {
    outputChannel.appendLine('[UI] No Qwen API key configured \u2014 engine will use the offline FakeProvider.');
  }

  transport = new EngineTransport(enginePath, outputChannel, extraEnv);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('junubAgent.dashscopeApiKey') ||
        e.affectsConfiguration('junubAgent.qwenBaseUrl') ||
        e.affectsConfiguration('junubAgent.qwenModel')
      ) {
        vscode.window
          .showInformationMessage('Junub Agent: reload the window to apply the new provider settings.', 'Reload')
          .then((choice) => {
            if (choice === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
      }
    }),
  );

  const progressProvider = new TaskProgressProvider();
  const progressView = vscode.window.createTreeView('junubAgentTaskProgress', { treeDataProvider: progressProvider });
  context.subscriptions.push(progressView);

  const filmTreeProvider = new FilmTreeProvider();
  const filmView = vscode.window.createTreeView('junubAgentFilmProject', { treeDataProvider: filmTreeProvider });
  context.subscriptions.push(filmView);

  transport.onProtocolEvent((evt) => {
    outputChannel.appendLine('[UI] Event: ' + evt.type + ' | Payload: ' + JSON.stringify(evt.payload || {}));
    if (evt.type === 'task.created') {
      progressProvider.reset();
    } else if (evt.type.startsWith('step.') || evt.type === 'task.started' || evt.type === 'task.succeeded') {
      const stepId = evt.payload?.stepId || evt.stepId || evt.taskId || 'unknown-step';
      const status = evt.type.split('.')[1];
      const mappedStatus = status === 'started' ? 'running' : status;
      const statement = evt.payload?.statement || evt.statement || stepId;
      progressProvider.updateStep(stepId, mappedStatus, statement);
    }
  });

  const inspectCmd = vscode.commands.registerCommand('junubAgent.inspectWorkspace', async () => {
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    outputChannel.show(true);
    outputChannel.appendLine('[UI] Requesting inspection for: ' + targetPath);
    try {
      const report = await client.request('pack.software.inspect', { path: targetPath });
      const src = report?.inventory?.source?.length ?? 0;
      const tst = report?.inventory?.tests?.length ?? 0;
      vscode.window.showInformationMessage('Junub Agent: ' + src + ' source, ' + tst + ' test files.');
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });

  const verifyCmd = vscode.commands.registerCommand('junubAgent.verifyWorkspace', async () => {
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = (await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Verifying...' },
        () => client.request('pack.software.verify', { path: targetPath }),
      )) as VerifyReport;
      showVerifyPanel(report);
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });

  const runTaskCmd = vscode.commands.registerCommand('junubAgent.runTask', async () => {
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Task Contracts': ['json'] } });
    if (!uris || uris.length === 0) return;
    const selectedUri = uris[0];
    if (!selectedUri) return;
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }

    try {
      const fileContent = fs.readFileSync(selectedUri.fsPath, 'utf8');
      const contract = JSON.parse(fileContent);
      outputChannel.show(true);
      outputChannel.appendLine('[UI] Generating plan for task: ' + (contract.taskId || contract.title));

      const planResult = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Junub Agent: generating plan...', cancellable: false },
        () => client.request('task.plan', { contract })
      ) as any;

      if (planResult.error) throw new Error(planResult.error.message || 'Plan generation failed');

      const review = await showPlanReviewPanel(context, planResult, contract);
      if (!review.approved) { vscode.window.showInformationMessage('Junub Agent: Task execution rejected by user.'); return; }
      if (!planResult.steps) { vscode.window.showInformationMessage('Junub Agent: Model refused to plan.'); return; }

      outputChannel.appendLine('[UI] Compiling approved plan...');
      const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
      const compileResult = await client.request('task.compile', {
        plan: planResult,
        context: { targetPath, domain: contract.domain || 'software', impact: contract.impact || 'low' }
      }) as any;

      if (compileResult.error) throw new Error(compileResult.error.message || 'Plan compilation failed');

      outputChannel.appendLine('[UI] Executing compiled plan...');
      const res = await client.request('task.run', { contract, plan: compileResult.steps });
      vscode.window.showInformationMessage('Task accepted: ' + res.taskId);
      vscode.commands.executeCommand('junubAgentTaskProgress.focus');
    } catch (e: any) {
      const msg = e.message || String(e);
      outputChannel.appendLine('[UI] Task failed: ' + msg);
      vscode.window.showErrorMessage('Failed to run task: ' + msg);
    }
  });

  const inspectFilmCmd = vscode.commands.registerCommand('junubAgent.inspectFilmProject', async () => {
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Inspect Film Project' });
    const selectedUri = uris && uris[0];
    if (!selectedUri) return;
    const targetPath = selectedUri.fsPath;
    outputChannel.show(true);
    outputChannel.appendLine('[UI] Inspecting film project: ' + targetPath);
    try {
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Junub Agent: inspecting film project', cancellable: false },
        () => fetchFilmReport(client, targetPath),
      );
      outputChannel.appendLine('[UI] Film inspection complete.');
      filmTreeProvider.setReport(report);
      showFilmPanel(report);
      const missingCount = report.checks.filter((c) => c.status === 'missing').length;
      vscode.window.showInformationMessage(missingCount > 0 ? 'Junub Agent: ' + missingCount + ' media file(s) missing.' : 'Junub Agent: all media linked.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage('Junub Agent film inspection failed: ' + message);
    }
  });

  const loadFilmCmd = vscode.commands.registerCommand('junubAgent.loadFilmProject', async () => {
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Load Film Project' });
    const selectedUri = uris && uris[0];
    if (!selectedUri) return;
    try {
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Junub Agent: loading film project', cancellable: false },
        () => fetchFilmReport(client, selectedUri.fsPath),
      );
      filmTreeProvider.setReport(report);
      vscode.commands.executeCommand('junubAgentFilmProject.focus');
      const missing = report.checks.filter((c) => c.status === 'missing').length;
      vscode.window.showInformationMessage('Junub Agent: loaded film project (' + report.mediaAssets.length + ' media, ' + missing + ' missing).');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage('Junub Agent film load failed: ' + message);
    }
  });

  const applyFilmPatchCmd = vscode.commands.registerCommand('junubAgent.applyFilmPatch', async () => {
    const client = transport;
    if (!client) { vscode.window.showErrorMessage('Junub Agent engine is not running.'); return; }
    const folderUris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select Film Project' });
    const folderUri = folderUris && folderUris[0];
    if (!folderUri) return;
    const patchUris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Patch': ['json'] }, openLabel: 'Select Patch' });
    const patchUri = patchUris && patchUris[0];
    if (!patchUri) return;
    try {
      const patch = JSON.parse(fs.readFileSync(patchUri.fsPath, 'utf8'));
      outputChannel.show(true);
      outputChannel.appendLine('[UI] Applying film patch to: ' + folderUri.fsPath);
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Junub Agent: applying film patch', cancellable: false },
        () => client.request('pack.film.applyPatch', { path: folderUri.fsPath, patch }),
      ) as any;
      if (report.scopeViolation) {
        vscode.window.showErrorMessage('Junub Agent: patch rejected \u2014 targets protected media: ' + report.scopeViolations.join(', '));
      } else if (!report.applied) {
        vscode.window.showWarningMessage('Junub Agent: patch not applied (worktree dirty or gate blocked).');
      } else {
        const missing = report.missingMedia?.length ?? 0;
        vscode.window.showInformationMessage('Junub Agent: patch applied (' + report.artifacts.length + ' artifact(s)). ' + (missing > 0 ? 'WARNING: ' + missing + ' media link(s) now missing.' : 'Media links OK.'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage('Junub Agent film patch failed: ' + message);
    }
  });

  const historyCmd = vscode.commands.registerCommand('junubAgent.viewHistory', () => {
    showHistoryPanel(context);
  });

  context.subscriptions.push(inspectCmd, verifyCmd, runTaskCmd, inspectFilmCmd, loadFilmCmd, applyFilmPatchCmd, historyCmd);
  outputChannel.appendLine('[UI] Junub Agent extension activated.');
}

export function deactivate(): void {
  if (transport) {
    transport.dispose();
    transport = undefined;
  }
}
