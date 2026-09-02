/**
 * SerialMutationQueue -- one-at-a-time execution of DocumentModel lifecycle
 * mutations (NIM-5359, defect E).
 *
 * Every file-watcher event runs its own un-awaited async handler, so two events
 * can interleave inside the model's `await`s and the older one can win. Ordering
 * therefore lives at the model boundary rather than in any one backing store:
 * mock, disk, hidden and future stores all inherit it.
 *
 * Two properties callers depend on:
 *
 * - **A rejected operation never stops the queue.** A tag lookup that fails
 *   because the history DB is momentarily busy is an ordinary transient; a plain
 *   `previous.then(next)` chain would wedge that document for the rest of the
 *   session.
 * - **An operation submitted while the queue is idle runs synchronously.** An
 *   editor reporting that its apply settled must observe the resulting drain
 *   before it returns; deferring that to a microtask would publish the next
 *   generation after the editor had already moved on.
 *
 * An operation must not submit to the queue re-entrantly and then await the
 * result -- the inner task cannot start until the outer one finishes.
 */
export class SerialMutationQueue {
  private running = false;
  private readonly waiting: Array<() => void> = [];

  /** True while an operation is in flight (including one suspended at an await). */
  get isBusy(): boolean {
    return this.running;
  }

  /**
   * Run `operation` after every previously submitted operation has settled.
   * The returned promise mirrors the operation's own outcome; a rejection is the
   * caller's to handle and does not affect anything queued behind it.
   */
  run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        let result: T | PromiseLike<T>;
        try {
          result = operation();
        } catch (err) {
          this.finish();
          reject(err);
          return;
        }

        if (isPromiseLike(result)) {
          Promise.resolve(result).then(
            (value) => {
              this.finish();
              resolve(value);
            },
            (err) => {
              this.finish();
              reject(err);
            },
          );
          return;
        }

        this.finish();
        resolve(result);
      };

      if (this.running) {
        this.waiting.push(task);
        return;
      }
      this.running = true;
      task();
    });
  }

  private finish(): void {
    const next = this.waiting.shift();
    if (next) {
      // Stay `running` -- the queue hands off directly to the next operation.
      next();
      return;
    }
    this.running = false;
  }
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T> | undefined)?.then === 'function';
}
