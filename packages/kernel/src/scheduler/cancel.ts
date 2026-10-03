/**
 * Cooperative cancellation token.
 *
 * The Master Spec requires that the engine distinguishes "cancel requested"
 * from "process stopped". This token allows long-running steps or retry
 * loops to cleanly abort and persist their state without throwing generic errors.
 */
export class CancellationToken {
  private _cancelled = false;
  private readonly _listeners = new Set<() => void>();

  get isCancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Signals cancellation to all listeners.
   */
  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    for (const listener of this._listeners) {
      try { listener(); } catch { /* Ignore listener errors during teardown */ }
    }
  }

  /**
   * Registers a callback to be invoked when cancellation is requested.
   * Returns an unsubscribe function.
   */
  on_cancel(listener: () => void): () => void {
    if (this._cancelled) {
      listener();
      return () => {};
    }
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}
