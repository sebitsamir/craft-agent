import * as vscode from 'vscode';
import { EngineTransport } from '../transport.js';

export function registerChatHandler(
  context: vscode.ExtensionContext,
  transport: EngineTransport,
  outputChannel: vscode.OutputChannel,
) {
  // Note: renamed 'context' to '_chatContext' here to avoid shadowing the outer ExtensionContext
  const handler: vscode.ChatRequestHandler = async (request, _chatContext, stream, token) => {
    const userMessage = request.prompt;
    outputChannel.appendLine(`[Chat] User message: ${userMessage}`);

    stream.markdown('$(sync~spin) **Thinking...**\n\n');

    try {
      // Convert natural language to a task contract
      const contract = {
        taskId: `chat-${Date.now()}`,
        title: userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : ''),
        intent: userMessage,
        domain: 'software',
        impact: 'low',
        outputs: [],
        acceptance: [
          {
            id: 'accept-1',
            statement: userMessage,
          },
        ],
      };

      stream.markdown('$(list-unordered) **Generating plan...**\n\n');

      // Generate plan
      const planResult = await transport.request('task.plan', { contract }) as any;

      if (planResult.error) {
        stream.markdown(`$(error) **Error:** ${planResult.error.message}\n`);
        return {};
      }

      if (!planResult.steps || planResult.steps.length === 0) {
        stream.markdown('$(info) The model refused to plan this task.\n');
        return {};
      }

      // Display the plan
      stream.markdown('### $(note) Proposed Plan\n\n');
      planResult.steps.forEach((step: any, index: number) => {
        stream.markdown(`${index + 1}. **${step.action}**: ${step.description}\n`);
      });
      stream.markdown('\n');

      // Ask for approval with professional codicon buttons
      stream.markdown('---\n');
      stream.markdown('**Do you want me to execute this plan?**\n\n');
      
      const approveButton = new vscode.MarkdownString('$(check) [Approve & Execute](command:junubAgent.approveChatTask)');
      const rejectButton = new vscode.MarkdownString('$(close) [Reject](command:junubAgent.rejectChatTask)');
      
      stream.markdown(approveButton.value + '  ' + rejectButton.value + '\n');

      // Store the plan for later execution using the OUTER context (ExtensionContext)
      context.workspaceState.update('pendingChatPlan', { contract, plan: planResult });

      return {};
    } catch (error: any) {
      stream.markdown(`$(error) **Error:** ${error.message}\n`);
      return {};
    }
  };

  const chatParticipant = vscode.chat.createChatParticipant('junubAgent.chat', handler);
  chatParticipant.iconPath = new vscode.ThemeIcon('robot');
  context.subscriptions.push(chatParticipant);

  // Register approve/reject commands
  const approveCmd = vscode.commands.registerCommand('junubAgent.approveChatTask', async () => {
    // Use the OUTER context (ExtensionContext) here
    const pending = context.workspaceState.get<any>('pendingChatPlan');
    if (!pending) {
      vscode.window.showErrorMessage('No pending task to approve.');
      return;
    }

    outputChannel.appendLine('[Chat] User approved the plan.');
    vscode.window.showInformationMessage('Junub Agent: Executing approved plan...');

    try {
      const targetPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
      const compileResult = await transport.request('task.compile', {
        plan: pending.plan,
        context: {
          targetPath,
          domain: pending.contract.domain || 'software',
          impact: pending.contract.impact || 'low',
        },
      }) as any;

      if (compileResult.error) {
        throw new Error(compileResult.error.message || 'Compilation failed');
      }

      const res = await transport.request('task.run', {
        contract: pending.contract,
        plan: compileResult.steps,
      });

      vscode.window.showInformationMessage(`Task accepted: ${res.taskId}`);
      vscode.commands.executeCommand('junubAgentTaskProgress.focus');
      
      // Clear the pending plan using the OUTER context
      context.workspaceState.update('pendingChatPlan', undefined);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to execute task: ${error.message}`);
    }
  });

  const rejectCmd = vscode.commands.registerCommand('junubAgent.rejectChatTask', async () => {
    // Clear the pending plan using the OUTER context
    context.workspaceState.update('pendingChatPlan', undefined);
    vscode.window.showInformationMessage('Junub Agent: Task rejected.');
  });

  context.subscriptions.push(approveCmd, rejectCmd);
}