import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { EngineTransport } from '../transport.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'junubAgentChat';
  private _view?: vscode.WebviewView;
  private history: ChatMessage[] = [];

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
      }
    });
  }

  private async _readWorkspaceContext(): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return 'No workspace open.';

    const parts: string[] = [];
    parts.push('Workspace root: ' + workspaceFolder);

    try {
      // 1. Read top-level structure
      const entries = await fs.readdir(workspaceFolder, { withFileTypes: true });
      const topLevel = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .slice(0, 50)
        .map(e => e.isDirectory() ? '  [DIR] ' + e.name + '/' : '  [FILE] ' + e.name)
        .join('\n');
      parts.push('\nTop-level structure:\n' + topLevel);

      // 2. Read package.json
      try {
        const pkgRaw = await fs.readFile(path.join(workspaceFolder, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgRaw);
        const deps = Object.keys(pkg.dependencies || {});
        const devDeps = Object.keys(pkg.devDependencies || {});
        parts.push('\npackage.json name: ' + (pkg.name || 'unknown'));
        parts.push('Dependencies: ' + (deps.length > 0 ? deps.join(', ') : 'none'));
        parts.push('DevDependencies: ' + (devDeps.length > 0 ? devDeps.join(', ') : 'none'));
        if (pkg.scripts) {
          parts.push('Scripts: ' + Object.keys(pkg.scripts).join(', '));
        }
      } catch { /* no package.json */ }

      // 3. Read tsconfig.json if exists
      try {
        const tsRaw = await fs.readFile(path.join(workspaceFolder, 'tsconfig.json'), 'utf8');
        parts.push('\ntsconfig.json exists: yes');
      } catch { /* no tsconfig */ }

      // 4. Recursively list src/ directory (2 levels deep)
      try {
        const srcTree = await this._listDir(path.join(workspaceFolder, 'src'), '', 2);
        if (srcTree) parts.push('\nsrc/ structure:\n' + srcTree);
      } catch { /* no src dir */ }

      // 5. Recursively list packages/ directory (2 levels deep)
      try {
        const pkgTree = await this._listDir(path.join(workspaceFolder, 'packages'), '', 2);
        if (pkgTree) parts.push('\npackages/ structure:\n' + pkgTree);
      } catch { /* no packages dir */ }

      // 6. Recursively list apps/ directory (2 levels deep)
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
    } catch {
      return '';
    }
  }

  private async _handleUserMessage(message: string) {
    this.outputChannel.appendLine('[Chat] User: ' + message);
    this.history.push({ role: 'user', content: message });
    this._postMessage({ type: 'status', text: '<span class="codicon codicon-sync~spin"></span> Reading workspace...' });

    try {
      // 1. Read the REAL workspace
      const workspaceContext = await this._readWorkspaceContext();
      this.outputChannel.appendLine('[Chat] Workspace context length: ' + workspaceContext.length + ' chars');

      this._postMessage({ type: 'status', text: '<span class="codicon codicon-sync~spin"></span> Thinking...' });

      // 2. Ask the LLM directly - no fake plans, just a real answer
      const result = await this.transport.request('chat.query', {
        message,
        history: this.history.slice(-6),
        workspaceContext,
      }) as any;

      if (result.error) {
        this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + result.error.message });
        return;
      }

      // 3. Display the REAL answer
      const responseText = result.response || 'No response received.';
      this.history.push({ role: 'assistant', content: responseText });
      this._postMessage({ type: 'response', text: this._formatMarkdown(responseText) });

    } catch (error: any) {
      this._postMessage({ type: 'response', text: '<span class="codicon codicon-error" style="color: var(--vscode-testing-iconFailed);"></span> Error: ' + (error.message || String(error)) });
    }
  }

  private _formatMarkdown(text: string): string {
    // Basic markdown to HTML conversion for the webview
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_match, _lang, code) {
      return '<pre class="code-block">' + code.trim() + '</pre>';
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return '<p>' + html + '</p>';
  }

  private _postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

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
    .message h1, .message h2, .message h3 { margin-top: 8px; margin-bottom: 4px; }
    .message p { margin: 4px 0; }
    .message li { margin: 2px 0; }
    .user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-align: right; }
    .assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
    .status { color: var(--vscode-descriptionForeground); font-style: italic; display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
    .code-block { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre-wrap; word-wrap: break-word; border-left: 3px solid var(--vscode-textLink-foreground); margin: 6px 0; overflow-x: auto; }
    .inline-code { background: var(--vscode-textBlockQuote-background); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    #input-area { display: flex; gap: 8px; }
    #message-input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; font-family: var(--vscode-font-family); font-size: 13px; }
    #send-btn { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: bold; }
    #send-btn:hover { background: var(--vscode-button-hoverBackground); }
    .codicon { font-size: 14px; }
  </style>
</head>
<body>
  <div id="chat-container"></div>
  <div id="input-area">
    <input type="text" id="message-input" placeholder="Ask about your codebase..." />
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
      }
    });
  </script>
</body>
</html>`;
  }
}
