import * as vscode from 'vscode';
import { EngineTransport } from './transport.js';
import { showVerifyPanel, type VerifyReport } from './views/verifyView.js';

let transport: EngineTransport | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Craft Agent');
  context.subscriptions.push(outputChannel);

  // Resolve the absolute path to the headless engine daemon and spawn it.
  const enginePath = context.asAbsolutePath('../../src/engine.mjs');
  transport = new EngineTransport(enginePath, outputChannel);

  // ---------------------------------------------------------------------
  // Command: Inspect Workspace
  // ---------------------------------------------------------------------
  const inspectCmd = vscode.commands.registerCommand('craftAgent.inspectWorkspace', async () => {
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage('Craft Agent engine is not running. Reload the window to restart it.');
      return;
    }

    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    outputChannel.show(true);
    outputChannel.appendLine(`[UI] Requesting inspection for: ${targetPath}`);

    try {
      const report = await client.request('pack.software.inspect', { path: targetPath });
      outputChannel.appendLine('[UI] Inspection complete.');
      outputChannel.appendLine(JSON.stringify(report, null, 2));

      const sourceCount = report?.inventory?.source?.length ?? 0;
      const testCount = report?.inventory?.tests?.length ?? 0;
      const dirtyNote = report?.git?.dirty === true ? ' (dirty worktree)' : '';
      vscode.window.showInformationMessage(
        `Craft Agent: ${sourceCount} source files, ${testCount} test files${dirtyNote}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[UI] Inspection failed: ${message}`);
      vscode.window.showErrorMessage(`Craft Agent inspection failed: ${message}`);
    }
  });

  // ---------------------------------------------------------------------
  // Command: Verify Workspace
  // ---------------------------------------------------------------------
  const verifyCmd = vscode.commands.registerCommand('craftAgent.verifyWorkspace', async () => {
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage('Craft Agent engine is not running. Reload the window to restart it.');
      return;
    }

    const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
    outputChannel.show(true);
    outputChannel.appendLine(`[UI] Requesting verification for: ${targetPath}`);

    try {
      // Show progress while declared checks run (they can take a while).
      const report = (await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Craft Agent: running declared checks',
          cancellable: false,
        },
        () => client.request('pack.software.verify', { path: targetPath }),
      )) as VerifyReport;

      outputChannel.appendLine('[UI] Verification complete.');
      outputChannel.appendLine(JSON.stringify(report, null, 2));

      // Render results with each check's status clearly distinguished.
      showVerifyPanel(report);

      const summary = report.passed ? 'all checks passed' : 'one or more checks did not pass';
      vscode.window.showInformationMessage(`Craft Agent: ${summary}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[UI] Verification failed: ${message}`);
      vscode.window.showErrorMessage(`Craft Agent verification failed: ${message}`);
    }
  });

  context.subscriptions.push(inspectCmd, verifyCmd);
  outputChannel.appendLine('[UI] Craft Agent extension activated.');
}

export function deactivate(): void {
  if (transport) {
    transport.dispose();
    transport = undefined;
  }
}
