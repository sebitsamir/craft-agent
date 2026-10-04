import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import * as vscode from 'vscode';

export class EngineTransport {
  private process: ChildProcess;
  private rl: ReturnType<typeof createInterface>;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private reqCounter = 0;
  private events = new EventEmitter();

  constructor(enginePath: string, private outputChannel: vscode.OutputChannel) {
    this.outputChannel.appendLine(`[Transport] Spawning engine: node ${enginePath}`);
    this.process = spawn('node', [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.rl = createInterface({ input: this.process.stdout!, terminal: false });
    this.rl.on('line', (line) => this.handleLine(line));

    this.process.stderr?.on('data', (chunk) => {
      this.outputChannel.appendLine(`[Engine Stderr] ${chunk.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`[Transport] Engine exited with code ${code}`);
      for (const [, { reject }] of this.pending) reject(new Error('Engine exited'));
      this.pending.clear();
    });
  }

  private handleLine(line: string) {
    try {
      const msg = JSON.parse(line);
      if ('requestId' in msg) {
        const pending = this.pending.get(msg.requestId);
        if (pending) {
          this.pending.delete(msg.requestId);
          msg.success ? pending.resolve(msg.result) : pending.reject(new Error(msg.error?.message));
        }
      } else if ('taskId' in msg && 'type' in msg) {
        // It's a ProtocolEvent
        this.events.emit('protocolEvent', msg);
      }
    } catch (err) {
      this.outputChannel.appendLine(`[Transport] Parse error: ${line}`);
    }
  }

  onProtocolEvent(listener: (evt: any) => void) {
    this.events.on('protocolEvent', listener);
  }

  async request(method: string, params?: unknown): Promise<any> {
    const requestId = `req-${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const payload = JSON.stringify({
        protocolVersion: 1, requestId, method, params, timestamp: new Date().toISOString()
      }) + '\n';
      this.process.stdin!.write(payload);
    });
  }

  dispose() {
    this.rl.close();
    this.process.kill();
  }
}
