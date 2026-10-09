import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EngineTransport } from '../transport.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface PendingEdit {
  filePath: string;
  originalContent: string;
  editedContent: string;
  instruction: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'junubAgentChat';
  private _view?: vscode.WebviewView;
  private history: ChatMessage[] = [];
  private pendingEdit: PendingEdit | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly transport: EngineTransport,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = this._getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'sendMessage') {
        await this._handleUserMessage(data.text);
      } else if (data.type === 'approveEdit') {
        await this._applyPendingEdit();
      } else if (data.type === 'rejectEdit') {
        this.pendingEdit = null;
        this._postMessage({ type: 'response', text: '<span class="codicon codicon-close" style="color: var(--vscode-testing-iconFailed);"></span> Edit rejected. No files were modified.' });
      } else if (data.type === 'viewDiff') {
        await this._showDiffPreview();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Workspace Context (unchanged)
  // -------------------------------------------------------------------------
  private async _readWorkspaceContext(): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return 'No workspace open.';
    const parts: string[] = [];
    parts.push('Workspace root: ' + workspaceFolder);
    try {
      const entries = await fs.readdir(workspaceFolder, { withFileTypes: true });
      const topLevel = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .slice(0, 50)
        .map(e => e.isDirectory() ? '  [DIR] ' + e.name + '/' : '  [FILE] ' + e.name)
        .join('\n');
      parts.push('\nTop-level structure:\n' + topLevel);
      try {
        const pkgRaw = await fs.readFile(path.join(workspaceFolder, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgRaw);
        const deps = Object.keys(pkg.dependencies || {});
        const devDeps = Object.keys(pkg.devDependencies || {});
        parts.push('\npackage.json name: ' + (pkg.name || 'unknown'));
        parts.push('Dependencies: ' + (deps.length > 0 ? deps.join(', ') : 'none'));
        parts.push('DevDependencies: ' + (devDeps.length > 0 ? devDeps.join(', ') : 'none'));
        if (pkg.scripts) parts.push('Scripts: ' + Object.keys(pkg.scripts).join(', '));
      } catch { /* no package.json */ }
      try {
        const srcTree = await this._listDir(path.join(workspaceFolder, 'src'), '', 2);
        if (srcTree) parts.push('\nsrc/ structure:\n' + srcTree);
      } catch { /* no src dir */ }
      try {
        const pkgTree = await this._listDir(path.join(workspaceFolder, 'packages'), '', 2);
        if (pkgTree) parts.push('\npackages/ structure:\n' + pkgTree);
      } catch { /* no packages dir */ }
      try {
        const appTree = await this._listDir(path.join(workspaceFolder, 'apps'), '', 2);
        if (appTree) parts.push('\napps/ structure:\n' + appTree);
      } catch { /* no apps dir */ }
    } catch (e: any) {
      parts.push('Error reading workspace: ' + e.message);
    }
    return parts.join('\n');
  }

  private async _listDir(dirPath: string, indent: string, maxDepth: number): Promise<string> {
    if (maxDepth <= 0) return '';
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const lines: string[] = [];
      const filtered = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
        .slice(0, 30);
      for (const entry of filtered) {
        if (entry.isDirectory()) {
          lines.push(indent + '  [DIR] ' + entry.name + '/');
          const sub = await this._listDir(path.join(dirPath, entry.name), indent + '  ', maxDepth - 1);
          if (sub) lines.push(sub);
        } else {
          lines.push(indent + '  [FILE] ' + entry.name);
        }
      }
      return lines.join('\n');
    } catch { return ''; }
  }

  // -------------------------------------------------------------------------
  // Edit Detection: Parse user message to see if they want to edit a file
  // -------------------------------------------------------------------------
  private _parseEditRequest(message: string): { filePath: string; instruction: string } | null {
    // Pattern: "edit <path> to <instruction>" or "edit <path>: <instruction>"
    const editPatterns = [
      /(?:edit|modify|update|change|refactor|add to|create)\s+([^\s]+\.\w+)\s+(?:to|:|with|by)\s+(.+)/i,
      /(?:edit|modify|update|change|refactor)\s+(?:the\s+)?file\s+([^\s]+\.\w+)\s+(?:to|:|with|by)\s+(.+)/i,
    ];

    for (const pattern of editPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && match[2]) {
        return { filePath: match[1].trim(), instruction: match[2].trim() };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Main Message Handler
  // -------------------------------------------------------------------------
  private async _handleUserMessage(message: string) {
    this.outputChannel.appendLine('[Chat] User: ' + message);
    this.history.push({ role: 'user', content: message });

    // Check if this is an edit request
    const editRequest = this._parseEditRequest(message);

    if (editRequest) {
      await this._handleEditRequest(editRequest.filePath, editRequest.instruction);
      return;
    }

    // Otherwise, handle as a normal question
    this._postMessage({ type: 'status', text: '<span class="codicon codicon-sync~spin"></span> Reading workspace...' });
    try {
      const workspaceContext = await this._readWorkspaceContext();
      this._postMessage({ type: 'status', text: '<span class="codicon codicon-sync~spin"></span> Thinking...' });

      const result = await this.transport.request('chat.query', {
        message,
        history: this.history.slice(-6),
        workspaceContext,
      }) as any;

      if (result.error) {
        this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + result.error.message });
        return;
      }

      const responseText = result.response || 'No response received.';
      this.history.push({ role: 'assistant', content: responseText });
      this._postMessage({ type: 'response', text: this._formatMarkdown(responseText) });
    } catch (error: any) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + (error.message || String(error)) });
    }
  }

  // -------------------------------------------------------------------------
  // File Edit Flow
  // -------------------------------------------------------------------------
  private async _handleEditRequest(filePath: string, instruction: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> No workspace open.' });
      return;
    }

    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceFolder, filePath);
    this.outputChannel.appendLine('[Chat] Edit request for: ' + fullPath);

    // 1. Read the file
    this._postMessage({ type: 'status', text: '<span class="codicon codicon-book"></span> Reading ' + filePath + '...' });
    let fileContent = '';
    try {
      fileContent = await fs.readFile(fullPath, 'utf8');
    } catch {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-warning" style="color: var(--vscode-editorWarning-foreground);"></span> File not found: <code>' + filePath + '</code>. Please check the path.' });
      return;
    }

    // 2. Get workspace context
    const workspaceContext = await this._readWorkspaceContext();

    // 3. Ask LLM to edit
    this._postMessage({ type: 'status', text: '<span class="codicon codicon-sync~spin"></span> Generating edit...' });
    try {
      const result = await this.transport.request('chat.edit', {
        filePath,
        instruction,
        fileContent,
        workspaceContext,
      }) as any;

      if (result.error) {
        this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + result.error.message });
        return;
      }

      // 4. Store pending edit and show diff
      this.pendingEdit = {
        filePath: fullPath,
        originalContent: result.originalContent,
        editedContent: result.editedContent,
        instruction: result.instruction,
      };

      const lineDiff = this._countChangedLines(result.originalContent, result.editedContent);
      let msg = '<h3><span class="codicon codicon-diff"></span> Proposed Edit</h3>';
      msg += '<p><strong>File:</strong> <code>' + filePath + '</code></p>';
      msg += '<p><strong>Instruction:</strong> ' + instruction + '</p>';
      msg += '<p><strong>Changes:</strong> ' + lineDiff + '</p>';
      msg += '<p><em>Use the buttons below to preview and apply the changes.</em></p>';

      this._postMessage({ type: 'edit', text: msg });

    } catch (error: any) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + (error.message || String(error)) });
    }
  }

  private _countChangedLines(original: string, edited: string): string {
    const origLines = original.split('\n');
    const editLines = edited.split('\n');
    let added = 0;
    let removed = 0;
    const maxLen = Math.max(origLines.length, editLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = origLines[i];
      const e = editLines[i];
      if (o !== e) {
        if (e !== undefined && (o === undefined || o !== e)) added++;
        if (o !== undefined && (e === undefined || o !== e)) removed++;
      }
    }
    return '+' + added + ' lines added, -' + removed + ' lines removed';
  }

  // -------------------------------------------------------------------------
  // Diff Preview
  // -------------------------------------------------------------------------
  private async _showDiffPreview() {
    if (!this.pendingEdit) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const relativePath = workspaceFolder ? path.relative(workspaceFolder, this.pendingEdit.filePath) : this.pendingEdit.filePath;

    // Write original and edited to temp files
    const tmpDir = os.tmpdir();
    const origTmp = path.join(tmpDir, 'junub-original-' + Date.now() + path.extname(this.pendingEdit.filePath));
    const editTmp = path.join(tmpDir, 'junub-edited-' + Date.now() + path.extname(this.pendingEdit.filePath));

    await fs.writeFile(origTmp, this.pendingEdit.originalContent, 'utf8');
    await fs.writeFile(editTmp, this.pendingEdit.editedContent, 'utf8');

    const origUri = vscode.Uri.file(origTmp);
    const editUri = vscode.Uri.file(editTmp);

    await vscode.commands.executeCommand('vscode.diff', origUri, editUri, 'Junub Agent: ' + relativePath);
  }

  // -------------------------------------------------------------------------
  // Apply Edit
  // -------------------------------------------------------------------------
  private async _applyPendingEdit() {
    if (!this.pendingEdit) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> No pending edit.' });
      return;
    }

    try {
      // Create backup
      const backupPath = this.pendingEdit.filePath + '.bak';
      await fs.writeFile(backupPath, this.pendingEdit.originalContent, 'utf8');

      // Write the edited content
      await fs.writeFile(this.pendingEdit.filePath, this.pendingEdit.editedContent, 'utf8');

      const relativePath = vscode.workspace.workspaceFolders?.[0]
        ? path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, this.pendingEdit.filePath)
        : this.pendingEdit.filePath;

      this._postMessage({ type: 'response', text: '<span class="codicon codicon-pass" style="color: var(--vscode-testing-iconPassed);"></span> <strong>File saved:</strong> <code>' + relativePath + '</code><br><span class="codicon codicon-shield"></span> Backup created at <code>' + path.basename(backupPath) + '</code>' });

      // Open the edited file in VS Code
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.pendingEdit.filePath));
      await vscode.window.showTextDocument(doc);

      this.history.push({ role: 'assistant', content: 'Applied edit to ' + relativePath + ': ' + this.pendingEdit.instruction });
      this.pendingEdit = null;

    } catch (error: any) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Failed to save: ' + (error.message || String(error)) });
    }
  }

  // -------------------------------------------------------------------------
  // Markdown formatting (unchanged)
  // -------------------------------------------------------------------------
  private _formatMarkdown(text: string): string {
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_m, _l, code) {
      return '<pre class="code-block">' + code.trim() + '</pre>';
    });
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    return '<p>' + html + '</p>';
  }

  private _postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  // -------------------------------------------------------------------------
  // HTML
  // -------------------------------------------------------------------------
  private _getHtmlForWebview() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Junub Agent Chat</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codicon/0.0.36/codicon.css">
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; margin: 0; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; color: var(--vscode-foreground); }
    #chat-container { flex: 1; overflow-y: auto; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; background: var(--vscode-editor-background); }
    .message { margin-bottom: 12px; padding: 10px; border-radius: 6px; line-height: 1.5; font-size: 13px; }
    .message h3 { margin-top: 0; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .message p { margin: 4px 0; }
    .message li { margin: 2px 0; }
    .user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-align: right; }
    .assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
    .status { color: var(--vscode-descriptionForeground); font-style: italic; display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
    .edit-preview { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-textLink-foreground); }
    .code-block { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; word-wrap: break-word; border-left: 3px solid var(--vscode-textLink-foreground); margin: 6px 0; overflow-x: auto; }
    .inline-code { background: var(--vscode-textBlockQuote-background); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    #input-area { display: flex; gap: 8px; }
    #message-input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; font-family: var(--vscode-font-family); font-size: 13px; }
    #send-btn { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: bold; }
    #send-btn:hover { background: var(--vscode-button-hoverBackground); }
    .edit-actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .edit-actions button { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; font-weight: bold; }
    .btn-diff { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .btn-approve { background: var(--vscode-testing-iconPassed); color: white; }
    .btn-reject { background: var(--vscode-testing-iconFailed); color: white; }
    .codicon { font-size: 14px; }
  </style>
</head>
<body>
  <div id="chat-container"></div>
  <div id="input-area">
    <input type="text" id="message-input" placeholder="Ask or say 'edit <file> to <instruction>'..." />
    <button id="send-btn"><span class="codicon codicon-send"></span> Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    function addMessage(text, type) {
      const div = document.createElement('div');
      div.className = 'message ' + type;
      div.innerHTML = text;
      chatContainer.appendChild(div);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function addEditActions() {
      const div = document.createElement('div');
      div.className = 'edit-actions';
      div.innerHTML =
        '<button class="btn-diff" onclick="viewDiff()"><span class="codicon codicon-diff"></span> Preview Diff</button>' +
        '<button class="btn-approve" onclick="approveEdit()"><span class="codicon codicon-check"></span> Approve & Save</button>' +
        '<button class="btn-reject" onclick="rejectEdit()"><span class="codicon codicon-close"></span> Reject</button>';
      chatContainer.appendChild(div);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function viewDiff() { vscode.postMessage({ type: 'viewDiff' }); }
    function approveEdit() {
      vscode.postMessage({ type: 'approveEdit' });
      document.querySelector('.edit-actions')?.remove();
    }
    function rejectEdit() {
      vscode.postMessage({ type: 'rejectEdit' });
      document.querySelector('.edit-actions')?.remove();
    }

    sendBtn.addEventListener('click', function() {
      const text = messageInput.value.trim();
      if (text) {
        addMessage(text, 'user');
        vscode.postMessage({ type: 'sendMessage', text: text });
        messageInput.value = '';
      }
    });

    messageInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendBtn.click();
    });

    window.addEventListener('message', function(event) {
      const message = event.data;
      if (message.type === 'response') {
        addMessage(message.text, 'assistant');
      } else if (message.type === 'status') {
        addMessage(message.text, 'status');
      } else if (message.type === 'edit') {
        addMessage(message.text, 'edit-preview');
        addEditActions();
      }
    });
  </script>
</body>
</html>`;
  }
}
