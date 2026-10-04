import * as vscode from 'vscode';
import { EngineTransport } from './transport.js';

/**
 * Minimal shape of the software-pack inspection report consumed by the UI.
 *
 * The full schema is owned by @craft-agent/pack-software. The extension
 * declares only the fields it reads so it stays decoupled from pack internals
 * and communicates strictly through the protocol result.
 */
interface InspectionReport {
  readonly root?: string;
  readonly inventory?: {
    readonly source?: readonly string[];
    readonly tests?: readonly string[];
  };
  readonly git?: {
    readonly available?: boolean;
    readonly dirty?: boolean | null;
  };
}

let transport: EngineTransport | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Craft Agent');
  context.subscriptions.push(outputChannel);

  // Resolve the absolute path to the headless engine daemon and spawn it.
  const enginePath = context.asAbsolutePath('../../src/engine.mjs');
  transport = new EngineTransport(enginePath, outputChannel);

  const inspectCmd = vscode.commands.registerCommand('craftAgent.inspectWorkspace', async () => {
    // Capture the transport in a local const and guard explicitly.
    // The module-level binding is mutable (deactivate may clear it), so
    // TypeScript cannot prove it is defined inside this async closure.
    const client = transport;
    if (!client) {
      vscode.window.showErrorMessage(
        'Craft Agent engine is not running. Reload the window to restart it.',
      );
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const targetPath = workspaceFolder?.uri.fsPath ?? '.';

    outputChannel.show(true);
    outputChannel.appendLine(`[UI] Requesting inspection for: ${targetPath}`);

    try {
      // Send the NDJSON request over the local transport.
      const report = (await client.request('pack.software.inspect', { path: targetPath })) as InspectionReport;

      outputChannel.appendLine('[UI] Inspection complete.');
      outputChannel.appendLine(JSON.stringify(report, null, 2));

      // Surface a bounded, honest summary to the user.
      const sourceCount = report.inventory?.source?.length ?? 0;
      const testCount = report.inventory?.tests?.length ?? 0;
      const dirtyNote = report.git?.dirty === true ? ' (dirty worktree)' : '';

      vscode.window.showInformationMessage(
        `Craft Agent: ${sourceCount} source files, ${testCount} test files${dirtyNote}.`,
      );
    } catch (error) {
      // Explicit failure state — never swallow or fabricate success.
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[UI] Inspection failed: ${message}`);
      vscode.window.showErrorMessage(`Craft Agent inspection failed: ${message}`);
    }
  });

  context.subscriptions.push(inspectCmd);
  outputChannel.appendLine('[UI] Craft Agent extension activated.');
}

export function deactivate(): void {
  if (transport) {
    transport.dispose();
    transport = undefined;
  }
}
