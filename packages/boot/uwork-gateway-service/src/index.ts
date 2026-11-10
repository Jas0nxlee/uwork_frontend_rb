/** Generation-scoped enterprise gateway reads; credentials remain inside Host callbacks. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import '@deepseek-ai/dsh-uwork-enterprise'
import { GatewayClient, GatewayRequestError } from '@deepseek-ai/dsh-uwork-gateway'
import type { GatewayConfig, GatewayUsage, UsageRequest } from '@deepseek-ai/dsh-uwork-gateway/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GatewayBinding, GatewayObservation, GatewayOverview, GatewayResource, OverviewState, UsageState } from './types.ts'

/** Request and successful-read cache budgets. */
export interface Config extends GatewayConfig {
  /** Successful aggregate cache lifetime in milliseconds; zero always revalidates. */
  readonly cacheTtlMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current enterprise gateway account and usage projections. */
    uworkGateway: GatewayService
  }
}
function isAborted(signal: AbortSignal): boolean { return signal.aborted }
function bindingKey(binding: GatewayBinding): string { return JSON.stringify([binding.orgId, binding.userId, binding.generation]) }
function failure(error: unknown): 'identity' | GatewayRequestError['kind'] {
  return error instanceof GatewayRequestError ? error.kind : 'identity'
}

/** Read-only enterprise gateway Remote service. */
export default class GatewayService extends TypertRemoteService {
  static inject = ['uworkIdentity']
  static Config = z.object({
    apiBaseUrl: z.string().required(),
    allowedModelEndpointOrigins: z.array(z.string()).required(),
    timeoutMs: z.natural().min(1).max(2147483647).default(30000),
    maxResponseBytes: z.natural().min(1).max(2147483647).default(524288),
    maxItems: z.natural().min(1).max(2147483647).default(10000),
    cacheTtlMs: z.natural().max(2147483647).default(30000),
  })
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly overview = new Map<string, GatewayObservation<GatewayOverview>>()
  private readonly usage = new Map<string, GatewayObservation<GatewayUsage>>()
  private readonly queries = new Map<'overview' | 'usage', AbortController>()
  private cacheOwner: string | undefined

  constructor(ctx: Context, private readonly options: Config) {
    super(ctx, 'uworkGateway')
    // Validate self-contained settings before the first authenticated request.
    new GatewayClient(options, { orgId: '', userId: '', generation: '', token: '', signal: this.lifetime.signal })
    ctx.on('uwork-identity/changed', () => {
      this.overview.clear()
      this.usage.clear()
      for (const query of this.queries.values()) query.abort()
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.pending])
      this.overview.clear()
      this.usage.clear()
    })
  }

  /** Read safe endpoint, masked key records, subscriptions and authorized model filters.
   * @param signal - Caller cancellation.
   * @returns Current identity's overview or a safe unavailable state.
   */
  @Remote
  async getOverview(signal: AbortSignal): Promise<OverviewState> {
    return this.track(this.readOverview(false, signal))
  }

  /** Refresh model permissions together with their owning account overview.
   * @param signal - Caller cancellation.
   * @returns Fresh safe overview; failure retains only this identity's last success.
   */
  @Remote
  async refreshModels(signal: AbortSignal): Promise<OverviewState> {
    return this.track(this.readOverview(true, signal))
  }

  /** Read the requested usage selection and cancel an older selection's pending read.
   * @param input - Period, metric and explicit server refresh request.
   * @param signal - Caller cancellation.
   * @returns Aggregates, authentication absence, or a classified failure with an optional last success.
   */
  @Remote
  async readUsage(input: UsageRequest, signal: AbortSignal): Promise<UsageState> {
    if (!['7d', 'month', '30d'].includes(input.period) || !['requests', 'cost', 'tokens'].includes(input.metric) ||
      (input.force !== undefined && typeof input.force !== 'boolean')) throw new RemoteError('uwork-gateway/invalid-query', 'Invalid gateway usage selection', {})
    return this.track(this.read('usage', `${input.period}:${input.metric}`, input.force === true, signal, this.usage,
      client => client.readUsage(input)))
  }

  /** Observe identity changes so open Client resources withdraw previous account data.
   * @param signal - Subscriber cancellation.
   * @returns Current safe identity binding, then coalesced changes; null means unauthenticated.
   */
  @Remote({ mode: 'stream' })
  async *watchIdentity(signal: AbortSignal): AsyncIterable<GatewayBinding | null> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    let changed = true
    let wake: (() => void) | undefined
    const notify = () => { changed = true; wake?.() }
    const stop = this.ctx.on('uwork-identity/changed', notify)
    active.addEventListener('abort', notify, { once: true })
    try {
      while (!isAborted(active)) {
        if (!changed) await new Promise<void>((resolve) => { wake = resolve })
        if (isAborted(active)) break
        changed = false
        const state = await this.track(this.ctx.uworkIdentity.getState())
        yield state.status === 'authenticated' ? { orgId: state.orgId, userId: state.userId, generation: state.generation } : null
      }
    } finally {
      stop()
      active.removeEventListener('abort', notify)
    }
  }

  private async readOverview(force: boolean, signal: AbortSignal): Promise<OverviewState> {
    return this.read('overview', '', force, signal, this.overview, async (client) => {
      const requests = [
        client.readPublicEndpoint(), client.listKeys(), client.readSubscriptions(), client.readPlanModels(),
      ] as const
      await Promise.allSettled(requests)
      const [publicEndpoint, keys, subscriptions, planModels] = await Promise.all(requests)
      return { publicEndpoint, keys, subscriptions, planModels }
    })
  }

  private async read<T>(channel: 'usage' | 'overview', selection: string, force: boolean, signal: AbortSignal,
    cache: Map<string, GatewayObservation<T>>, run: (client: GatewayClient) => Promise<T>): Promise<GatewayResource<T>> {
    this.queries.get(channel)?.abort()
    const query = new AbortController()
    this.queries.set(channel, query)
    const active = AbortSignal.any([signal, this.lifetime.signal, query.signal])
    const cancelled = () => {
      if (active.aborted) throw new RemoteError('uwork-gateway/cancelled', 'Gateway read was cancelled', {})
    }
    cancelled()
    try {
      const state = await this.ctx.uworkIdentity.getState()
      cancelled()
      if (state.status !== 'authenticated') {
        this.overview.clear()
        this.usage.clear()
        return { status: 'signed-out' }
      }
      const outcome = await this.ctx.uworkIdentity.withSession(async (session): Promise<GatewayResource<T>> => {
        const binding: GatewayBinding = { orgId: session.orgId, userId: session.userId, generation: session.generation }
        const owner = bindingKey(binding)
        if (owner !== this.cacheOwner) {
          this.overview.clear()
          this.usage.clear()
          this.cacheOwner = owner
        }
        const previous = cache.get(selection)
        if (!force && previous !== undefined && Date.now() - previous.updatedAt < this.options.cacheTtlMs) return { status: 'ready', ...previous }
        try {
          const data = await run(new GatewayClient(this.options, { ...session, signal: AbortSignal.any([active, session.signal]) }))
          return { status: 'ready', data, updatedAt: Date.now(), binding }
        } catch (error) {
          return { status: 'error', reason: failure(error), ...(previous === undefined ? {} : { lastSuccess: previous }) }
        }
      }, active)
      // Even failed reads return through the identity owner's final generation check.
      cancelled()
      if (outcome.status === 'ready') cache.set(selection, outcome)
      return outcome
    } catch (error) {
      cancelled()
      // Identity ownership could not be verified; no cached account data may be projected.
      return { status: 'error', reason: failure(error) }
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise))
    return promise
  }
}
