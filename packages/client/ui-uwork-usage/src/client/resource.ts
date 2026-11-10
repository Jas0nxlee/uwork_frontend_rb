/** Enterprise usage resources follow the shared reconnecting Remote stream supervisor. */
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
export type {} from '@deepseek-ai/dsh-uwork-gateway-service/remote'
import type { GatewayBinding, GatewayResource } from '@deepseek-ai/dsh-uwork-gateway-service/types'
import type { UsagePageData } from './types.ts'

/** Transport capabilities required by the usage resource. */
export type UsageRemote = Pick<ClientRemote, '$stream' | 'uworkGateway'>
function isAborted(signal: AbortSignal): boolean { return signal.aborted }
function matchesIdentity(binding: GatewayBinding, state: GatewayResource<unknown>): boolean {
  const owner = state.status === 'ready' ? state.binding
    : state.status === 'error' ? state.lastSuccess?.binding : undefined
  return owner === undefined || (owner.orgId === binding.orgId && owner.userId === binding.userId &&
    owner.generation === binding.generation)
}

/** Open a usage selection across Host transport generations, clearing account data on carrier loss.
 * @param remote - Generated gateway methods and the reconnecting stream supervisor.
 * @param address - Resource address encoding period, metric and refresh revision.
 * @param signal - Resource holder lifetime.
 * @returns Safe current projections; unavailable states clear previous account data.
 */
export async function* openUsage(remote: UsageRemote, address: string, signal: AbortSignal): AsyncIterable<RemoteResult<UsagePageData>> {
  const url = new URL(address)
  const [period, metric, refresh] = url.pathname.slice(1).split('/')
  if ((period !== '7d' && period !== 'month' && period !== '30d') ||
    (metric !== 'requests' && metric !== 'cost' && metric !== 'tokens') || !/^\d+$/.test(refresh ?? '')) {
    yield { ok: false, error: new RemoteError('uwork-gateway/invalid-query', 'Invalid usage address', {}) }
    return
  }
  let pending: RemoteResult<UsagePageData> | undefined
  let wake: (() => void) | undefined
  const lifecycle = { finished: false }
  const publish = (value: UsagePageData) => { pending = { ok: true, value }; wake?.() }
  const stream = remote.$stream<UsagePageData>({
    name: 'enterprise usage',
    carrierFailed: () => { publish({ status: 'unavailable' }) },
    ended: () => new Error('Enterprise usage identity stream ended'),
    open: async function* (generationSignal) {
      const active = AbortSignal.any([signal, generationSignal])
      for await (const binding of remote.uworkGateway.watchIdentity(active)) {
        if (binding === null) { yield { status: 'signed-out' }; continue }
        yield { status: 'loading' }
        const [overview, usage] = await Promise.all([
          remote.uworkGateway.getOverview(active), remote.uworkGateway.readUsage({ period, metric, force: refresh !== '0' }, active),
        ])
        if (isAborted(active)) return
        if (!overview.ok || !usage.ok) { yield { status: 'unavailable' }; continue }
        if ([overview.value, usage.value].some(value => value.status === 'error' && value.reason === 'identity')) {
          yield { status: 'unavailable' }
          continue
        }
        if (!matchesIdentity(binding, overview.value) || !matchesIdentity(binding, usage.value)) continue
        yield usage.value.status === 'signed-out' || overview.value.status === 'signed-out'
          ? { status: 'signed-out' } : { status: 'ready', overview: overview.value, usage: usage.value }
      }
    },
  })
  const stop = () => { void stream.dispose() }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  const work = (async () => {
    try {
      for await (const frame of stream) { frame.accept(); publish(frame.value) }
    } catch (error) {
      // The supervisor owns carrier retry; terminal diagnostics never enter resource data.
      void error
      publish({ status: 'unavailable' })
    } finally { lifecycle.finished = true; wake?.() }
  })()
  try {
    while (!isAborted(signal)) {
      if (pending !== undefined) { const next = pending; pending = undefined; yield next; continue }
      if (lifecycle.finished) return
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } finally {
    signal.removeEventListener('abort', stop)
    await stream.dispose()
    await work
  }
}
