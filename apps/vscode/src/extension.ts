import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { EngineTransport } from './transport.js';
import { showVerifyPanel, type VerifyReport } from './views/verifyView.js';
import { showFilmPanel, type FilmReportView } from './views/filmView.js';
import { FilmTreeProvider } from './views/filmTree.js';
import { TaskProgressProvider } from './views/taskProgressView.js';
import { showPlanReviewPanel } from './views/planReviewView.js';
import { showHistoryPanel } from './views/historyView.js';
import { ChatViewProvider } from './views/chatView.js';

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

  // 1. Read provider settings from VS Code
  const junubConfig = vscode.workspace.getConfiguration('junubAgent');
  const provider = junubConfig.get<string>('provider') || 'dashscope';
  let apiKey = junubConfig.get<string>('dashscopeApiKey') || '';
  let baseUrl = junubConfig.get<string>('qwenBaseUrl') || '';
  let model = junubConfig.get<string>('qwenModel') || '';

  // 2. Auto-configure based on provider selection (Respecting user Base URL overrides)
  if (provider === 'ollama') {
    baseUrl = baseUrl || 'http://localhost:11434/v1';
    model = model || 'qwen2.5:3b';
    apiKey = apiKey || 'ollama';
    outputChannel.appendLine('[UI] Provider: Ollama (Local) — Base URL: ' + baseUrl + ' — Model: ' + model);
  } else if (provider === 'openrouter') {
    baseUrl = baseUrl || 'https://openrouter.ai/api/v1';
    model = model || 'qwen/qwen-2.5-72b-instruct';
    outputChannel.appendLine('[UI] Provider: OpenRouter — Base URL: ' + baseUrl + ' — Model: ' + model);
  } else {
    baseUrl = baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    model = model || 'qwen-max';
    outputChannel.appendLine('[UI] Provider: DashScope — Base URL: ' + baseUrl + ' — Model: ' + model);
  }

  // 3. Build the environment variables to pass to the engine
  const extraEnv: Record<string, string> = {};
  if (apiKey && apiKey.trim()) {
    extraEnv.DASHSCOPE_API_KEY = apiKey.trim();
    extraEnv.OPENROUTER_API_KEY = apiKey.trim(); // Ensure OpenRouter sees the key
  }
  if (baseUrl && baseUrl.trim()) extraEnv.QWEN_BASE_URL = baseUrl.trim();
  if (model && model.trim()) extraEnv.QWEN_MODEL = model.trim();

  // 4. Spawn the engine WITH the extra environment variables
  transport = new EngineTransport(enginePath, outputChannel, extraEnv);

  // Reload prompt when settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('junubAgent')) {
        vscode.window
          .showInformationMessage('Junub Agent: reload the window to apply new provider settings.', 'Reload')
          .then((choice) => {
            if (choice === 'Reload') vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
      }
    }),
  );

  // Task progress tree view
  const progressProvider = new TaskProgressProvider();
  context.subscriptions.push(vscode.window.createTreeView('junubAgentTaskProgress', { treeDataProvider: progressProvider }));

  // Film project tree view
  const filmTreeProvider = new FilmTreeProvider();
  context.subscriptions.push(vscode.window.createTreeView('junubAgentFilmProject', { treeDataProvider: filmTreeProvider }));

  // Chat view
  if (transport) {
    const chatProvider = new ChatViewProvider(context.extensionUri, transport, outputChannel);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider));
  }

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

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------
  const inspectCmd = vscode.commands.registerCommand('junubAgent.inspectWorkspace', async () => {
    if (!transport) { vscode.window.showErrorMessage('Engine not running.'); return; }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = await transport.request('pack.software.inspect', { path: targetPath });
      vscode.window.showInformationMessage(`Junub Agent: ${report?.inventory?.source?.length ?? 0} source, ${report?.inventory?.tests?.length ?? 0} test files.`);
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });

  const verifyCmd = vscode.commands.registerCommand('junubAgent.verifyWorkspace', async () => {
    if (!transport) { vscode.window.showErrorMessage('Engine not running.'); return; }
    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    try {
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Verifying...' }, () => transport!.request('pack.software.verify', { path: targetPath })) as VerifyReport;
      showVerifyPanel(report);
    } catch (e: any) { vscode.window.showErrorMessage(e.message); }
  });

  const runTaskCmd = vscode.commands.registerCommand('junubAgent.runTask', async () => {
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Task Contracts': ['json'] } });
    if (!uris || uris.length === 0 || !transport) return;
    const selectedUri = uris[0]; // <-- TypeScript now knows this is defined
    if (!selectedUri) return;

    try {
      const contract = JSON.parse(fs.readFileSync(selectedUri.fsPath, 'utf8'));
      outputChannel.show(true);
      outputChannel.appendLine('[UI] Generating plan for task: ' + (contract.taskId || contract.title));

      const planResult = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Junub Agent: generating plan...', cancellable: false }, () => transport!.request('task.plan', { contract })) as any;
      if (planResult.error) throw new Error(planResult.error.message || 'Plan generation failed');

      const review = await showPlanReviewPanel(context, planResult, contract);
      if (!review.approved) { vscode.window.showInformationMessage('Task execution rejected.'); return; }
      if (!planResult.steps) { vscode.window.showInformationMessage('Model refused to plan.'); return; }

      const compileResult = await transport.request('task.compile', { plan: planResult, context: { targetPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.', domain: contract.domain || 'software', impact: contract.impact || 'low' } }) as any;
      if (compileResult.error) throw new Error(compileResult.error.message || 'Compilation failed');

      const res = await transport.request('task.run', { contract, plan: compileResult.steps });
      vscode.window.showInformationMessage('Task accepted: ' + res.taskId);
      vscode.commands.executeCommand('junubAgentTaskProgress.focus');
    } catch (e: any) { vscode.window.showErrorMessage('Failed to run task: ' + (e.message || String(e))); }
  });

  const inspectFilmCmd = vscode.commands.registerCommand('junubAgent.inspectFilmProject', async () => {
    if (!transport) { vscode.window.showErrorMessage('Engine not running.'); return; }
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Inspect Film Project' });
    if (!uris || uris.length === 0) return;
    const selectedUri = uris[0]; // <-- TypeScript now knows this is defined
    if (!selectedUri) return;

    try {
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Inspecting film project...' }, () => fetchFilmReport(transport!, selectedUri.fsPath));
      showFilmPanel(report);
      const missing = report.checks.filter((c) => c.status === 'missing').length;
      vscode.window.showInformationMessage(missing > 0 ? `${missing} media file(s) missing.` : 'All media linked.');
    } catch (error: any) { vscode.window.showErrorMessage('Film inspection failed: ' + (error.message || String(error))); }
  });

  const loadFilmCmd = vscode.commands.registerCommand('junubAgent.loadFilmProject', async () => {
    if (!transport) { vscode.window.showErrorMessage('Engine not running.'); return; }
    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Load Film Project' });
    if (!uris || uris.length === 0) return;
    const selectedUri = uris[0]; // <-- TypeScript now knows this is defined
    if (!selectedUri) return;

    try {
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading film project...' }, () => fetchFilmReport(transport!, selectedUri.fsPath));
      vscode.commands.executeCommand('junubAgentFilmProject.focus');
      const missing = report.checks.filter((c) => c.status === 'missing').length;
      vscode.window.showInformationMessage(`Loaded film project (${report.mediaAssets.length} media, ${missing} missing).`);
    } catch (error: any) { vscode.window.showErrorMessage('Film load failed: ' + (error.message || String(error))); }
  });

  const applyFilmPatchCmd = vscode.commands.registerCommand('junubAgent.applyFilmPatch', async () => {
    if (!transport) { vscode.window.showErrorMessage('Engine not running.'); return; }
    const folderUris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select Film Project' });
    if (!folderUris || folderUris.length === 0) return;
    const folderUri = folderUris[0]; // <-- TypeScript now knows this is defined
    if (!folderUri) return;

    const patchUris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Patch': ['json'] }, openLabel: 'Select Patch' });
    if (!patchUris || patchUris.length === 0) return;
    const patchUri = patchUris[0]; // <-- TypeScript now knows this is defined
    if (!patchUri) return;

    try {
      const patch = JSON.parse(fs.readFileSync(patchUri.fsPath, 'utf8'));
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Applying film patch...' }, () => transport!.request('pack.film.applyPatch', { path: folderUri.fsPath, patch })) as any;
      if (report.scopeViolation) vscode.window.showErrorMessage('Patch rejected — targets protected media.');
      else if (!report.applied) vscode.window.showWarningMessage('Patch not applied (worktree dirty or gate blocked).');
      else vscode.window.showInformationMessage(`Patch applied (${report.artifacts.length} artifact(s)).`);
    } catch (error: any) { vscode.window.showErrorMessage('Film patch failed: ' + (error.message || String(error))); }
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
