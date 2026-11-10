/** Private Host/Main authorization requests; never mounted on the renderer Remote bus. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-native-authorization'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NativeAuthorizationAttemptId, NativeAuthorizationProvider } from '@deepseek-ai/dsh-native-authorization/types'

/** Install a correlated, cancelable native authorization IPC owner.
 * @param context - Booted product context.
 * @param send - Private child-process reply transport.
 * @returns Request handler and quiescent shutdown.
 */
export function nativeAuthorizationBridge(context: Promise<Context>, send: (value: object) => Promise<void>): {
  handle(message: unknown): boolean
  dispose(): Promise<void>
} {
  // The application owner reports boot failure; a bridge with no requests must not create an unhandled derived rejection.
  void context.catch(() => {})
  const reads = new Map<number, AbortController>()
  const tasks = new Set<Promise<void>>()
  const attempts = new Map<NativeAuthorizationAttemptId, NativeAuthorizationProvider>()
  const cancellations = new Map<NativeAuthorizationAttemptId, Promise<unknown>>()
  const cancel = (id: NativeAuthorizationAttemptId, provider: NativeAuthorizationProvider): Promise<unknown> => {
    const pending = cancellations.get(id)
    if (pending !== undefined) return pending
    const task = Promise.resolve().then(() => provider.cancel(id)).finally(() => {
      attempts.delete(id)
      cancellations.delete(id)
    })
    cancellations.set(id, task)
    return task
  }
  let stopped = false
  return {
    handle(message) {
      if (message === null || typeof message !== 'object' || !('type' in message)) return false
      if (message.type === 'native-authorization-cancel-request') {
        if ('requestId' in message && typeof message.requestId === 'number') reads.get(message.requestId)?.abort()
        return true
      }
      if (message.type !== 'native-authorization') return false
      if (!('requestId' in message) || typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId)
        || !('action' in message) || typeof message.action !== 'string') return true
      const { requestId, action } = message
      if (reads.has(requestId)) return true
      const abort = new AbortController()
      reads.set(requestId, abort)
      const task = (async () => {
        let owned: { id: NativeAuthorizationAttemptId; provider: NativeAuthorizationProvider } | undefined
        let cancellation: Promise<unknown> | undefined
        const withdraw = () => {
          if (owned !== undefined && attempts.get(owned.id) === owned.provider && cancellation === undefined) {
            cancellation = cancel(owned.id, owned.provider).catch(() => {})
          }
        }
        abort.signal.addEventListener('abort', withdraw, { once: true })
        try {
          if (stopped) throw new Error('Unavailable')
          const ctx = await context
          abort.signal.throwIfAborted()
          const provider = ctx.get('nativeAuthorization')?.getProvider()
          let value: unknown
          if (action === 'state') value = provider === undefined ? null : await provider.getState()
          else {
            if (provider === undefined) throw new Error('Unavailable')
            if (action === 'start' && 'choiceId' in message && typeof message.choiceId === 'string' && message.choiceId.length <= 256) {
              const attempt = await provider.start(message.choiceId, abort.signal)
              owned = { id: attempt.id, provider }
              attempts.set(attempt.id, provider)
              if (abort.signal.aborted) withdraw()
              value = attempt
            } else {
              if (!('id' in message) || typeof message.id !== 'string' || message.id.length > 256) throw new Error('Invalid attempt')
              const id = brandString<NativeAuthorizationAttemptId>(message.id)
              if (attempts.get(id) === provider) owned = { id, provider }
              if (action === 'complete' && 'url' in message && typeof message.url === 'string' && message.url.length <= 16384) value = await provider.complete(id, message.url, abort.signal)
              else if (action === 'poll') value = await provider.poll(id, abort.signal)
              else if (action === 'cancel') { value = await cancel(id, provider); owned = undefined }
              else throw new Error('Invalid operation')
            }
          }
          abort.signal.throwIfAborted()
          if (owned !== undefined && value !== null && typeof value === 'object' && 'status' in value && value.status !== 'pending') attempts.delete(owned.id)
          await send({ type: 'native-authorization', requestId, value })
        } catch {
          if (owned !== undefined && (abort.signal.aborted || stopped)) {
            withdraw()
            await cancellation
          }
          // Issuer errors may contain authorization codes or credentials; only a fixed diagnostic crosses IPC.
          await send({ type: 'native-authorization', requestId, error: 'Native authorization unavailable' })
        } finally {
          abort.signal.removeEventListener('abort', withdraw)
          reads.delete(requestId)
        }
      })().catch(() => {})
      tasks.add(task)
      void task.finally(() => { tasks.delete(task) })
      return true
    },
    async dispose() {
      stopped = true
      for (const abort of reads.values()) abort.abort()
      await Promise.allSettled([...attempts].map(([id, provider]) => cancel(id, provider)))
      await Promise.allSettled(tasks)
      await Promise.allSettled(cancellations.values())
    },
  }
}
