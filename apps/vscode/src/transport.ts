import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as vscode from 'vscode';

interface ProtocolRequest {
  protocolVersion: 1;
  requestId: string;
  method: string;
  params?: unknown;
  timestamp: string;
}

interface ProtocolResponse {
  protocolVersion: 1;
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
  timestamp: string;
}

export class EngineTransport {
  private process: ChildProcess;
  private rl: ReturnType<typeof createInterface>;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private reqCounter = 0;

  constructor(enginePath: string, private outputChannel: vscode.OutputChannel) {
    this.outputChannel.appendLine(`[Transport] Spawning engine: node ${enginePath}`);

    // Spawn the headless engine as a child process
    this.process = spawn('node', [enginePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Read NDJSON responses line-by-line from stdout
    this.rl = createInterface({ input: this.process.stdout!, terminal: false });
    this.rl.on('line', (line) => this.handleLine(line));

    // Route engine stderr to the VS Code output channel for diagnostics
    this.process.stderr?.on('data', (chunk) => {
      this.outputChannel.appendLine(`[Engine Stderr] ${chunk.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`[Transport] Engine exited with code ${code}`);
      for (const [, { reject }] of this.pending) {
        reject(new Error('Engine process exited unexpectedly'));
      }
      this.pending.clear();
    });
  }

  private handleLine(line: string) {
    try {
      const response: ProtocolResponse = JSON.parse(line);
      const pending = this.pending.get(response.requestId);
      if (!pending) return;

      this.pending.delete(response.requestId);

      if (response.success) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.error?.message || 'Unknown engine error'));
      }
    } catch (err) {
      this.outputChannel.appendLine(`[Transport] Failed to parse engine response: ${line}`);
    }
  }

  async request(method: string, params?: unknown): Promise<any> {
    const requestId = `req-${++this.reqCounter}`;
    const request: ProtocolRequest = {
      protocolVersion: 1,
      requestId,
      method,
      params,
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const payload = JSON.stringify(request) + '\n';
      this.outputChannel.appendLine(`[Transport] -> ${method}`);
      this.process.stdin!.write(payload);
    });
  }

  dispose() {
    this.rl.close();
    this.process.kill();
  }
}
