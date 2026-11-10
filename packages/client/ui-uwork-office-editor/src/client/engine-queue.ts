/** Serial access to the DOCX SDK's module-owned import/export working state. */

/** One plugin lifetime's temporary engine operations. */
export interface OfficeEngineQueue {
  /**
   * Run after earlier operations settle, including their cleanup.
   * @param operation - isolated import or snapshot export.
   * @param signal - cancellation checked before admitting the operation.
   * @returns the operation's result; failure does not block subsequent operations.
   */
  run<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T>
  /**
   * Wait for every previously queued operation to settle.
   * @returns completed drain.
   */
  idle(): Promise<void>
}

/**
 * Create a queue shared by all documents in one editor plugin installation.
 * @returns serialized temporary-engine access without process-global state.
 */
export function createOfficeEngineQueue(): OfficeEngineQueue {
  let tail = Promise.resolve()
  return {
    async run(operation, signal) {
      const previous = tail
      const turn = Promise.withResolvers<void>()
      tail = turn.promise
      await previous
      try {
        signal.throwIfAborted()
        return await operation()
      } finally { turn.resolve() }
    },
    idle: () => tail,
  }
}
