/** Bounded Host-only enterprise gateway transport. No credential or raw response logging. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { GatewayConfig, GatewayFailureKind, GatewayKey, GatewayKeyId, GatewayModel, GatewayPlanModels, GatewaySession, GatewaySubscription, GatewayUsage, UsageRequest } from './types.ts'

/** Structured request failure; unknown mutation outcomes require reconciliation before retry. */
export class GatewayRequestError extends Error {
  constructor(readonly kind: GatewayFailureKind, readonly status?: number,
    readonly mutationOutcome: 'unchanged' | 'unknown' = 'unchanged') {
    super(`Enterprise gateway request failed: ${kind}`)
    this.name = 'GatewayRequestError'
  }
}
const text = z.string().trim().min(1)
const id = z.union([text, z.number().int().nonnegative()]).transform(String)
const optionalText = z.string().nullable().optional().transform(value => value?.trim() || null)
const count = z.number().nonnegative()
const key = z.object({ id, alias: optionalText, masked_key: text, status: text })
const period = z.enum(['7d', 'month', '30d'])
const metric = z.enum(['requests', 'cost', 'tokens'])
const summary = z.object({ requestCount: count, successCount: count, successRate: count.max(100), cost: z.number(),
  averageCost: z.number(), promptTokens: count, completionTokens: count, totalTokens: count,
  cacheReadTokens: count, cacheCreationTokens: count })

function isAborted(signal: AbortSignal): boolean { return signal.aborted }

function publicHttps(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  // Deployment service addresses exclude IP literals, local names, credentials and URL metadata.
  // Discovered model endpoints additionally require the configured exact origin allowlist.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw new Error('Expected public HTTPS service URL')
  return url
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new GatewayRequestError('invalid')
  return result.data
}
function toKey(value: z.infer<typeof key>): GatewayKey {
  return { id: brandString<GatewayKeyId>(value.id), alias: value.alias, maskedKey: value.masked_key, status: value.status }
}

/** Gateway client scoped to one Host identity callback; never retain it across withSession calls. */
export class GatewayClient {
  private readonly base: URL
  private publicEndpoint: string | undefined
  private readonly allowedOrigins: ReadonlySet<string>
  constructor(private readonly config: GatewayConfig, private readonly session: GatewaySession,
    private readonly fetchImpl: typeof fetch = fetch) {
    this.base = publicHttps(config.apiBaseUrl)
    if (this.base.pathname !== '/') throw new Error('Control plane URL must be an origin')
    this.allowedOrigins = new Set(config.allowedModelEndpointOrigins.map((value) => {
      const url = publicHttps(value)
      if (url.pathname !== '/') throw new Error('Model allowlist entries must be origins')
      return url.origin
    }))
    if (this.allowedOrigins.size === 0) throw new Error('Model endpoint allowlist must not be empty')
    for (const value of [config.timeoutMs, config.maxResponseBytes, config.maxItems]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('Invalid gateway limit')
    }
  }

  private async send(method: 'GET' | 'POST', path: string, body?: object, endpoint?: { url: URL; apiKey: string }): Promise<unknown> {
    const mutation = method === 'POST'
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([this.session.signal, timeout])
    const outcome = mutation ? 'unknown' : 'unchanged'
    if (isAborted(signal)) throw new GatewayRequestError('cancelled')
    let response: Response
    try {
      const target = endpoint?.url ?? new URL(path, this.base)
      response = await this.fetchImpl(target, { method, redirect: 'error', signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${endpoint?.apiKey ?? this.session.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
      if (!response.ok) {
        try { await response.body?.cancel() }
        catch (error) {
          // HTTP status remains authoritative when discarding its private body fails.
          void error
        }
        const kind = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limited' : 'http'
        throw new GatewayRequestError(kind, response.status, mutation && (response.status >= 500 || response.status === 408) ? 'unknown' : 'unchanged')
      }
      if (!response.body) throw new GatewayRequestError('invalid', undefined, outcome)
      const reader = response.body.getReader()
      const cancelBody = () => {
        void reader.cancel().catch((error: unknown) => {
          // The request's structured cancellation owns this failure; discard transport details.
          void error
        })
      }
      signal.addEventListener('abort', cancelBody, { once: true })
      if (isAborted(signal)) cancelBody()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (isAborted(signal)) throw new GatewayRequestError(this.session.signal.aborted ? 'cancelled' : 'timeout', undefined, outcome)
          if (part.done) break
          size += part.value.byteLength
          if (size > this.config.maxResponseBytes) {
            await reader.cancel()
            throw new GatewayRequestError('invalid', undefined, outcome)
          }
          chunks.push(part.value)
        }
      } finally {
        signal.removeEventListener('abort', cancelBody)
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      catch { throw new GatewayRequestError('invalid', undefined, outcome) }
    } catch (error) {
      if (error instanceof GatewayRequestError) throw error
      const kind = this.session.signal.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : 'network'
      throw new GatewayRequestError(kind, undefined, outcome)
    }
  }

  /** Read masked records for the current identity.
   * @returns Masked records without secret material.
   */
  async listKeys(): Promise<readonly GatewayKey[]> {
    return parse(z.object({ keys: z.array(key).max(this.config.maxItems) }), await this.send('GET', '/api/keys')).keys.map(toKey)
  }
  /** Reveal one key to Host credential storage.
   * @param keyId - Server-admitted identifier.
   * @returns Secret for Host storage only.
   */
  async revealKey(keyId: GatewayKeyId): Promise<string> {
    return parse(z.object({ key: text }), await this.send('GET', `/api/keys/${encodeURIComponent(keyId)}/reveal`)).key
  }
  /** Generate one key without automatic retries.
   * @param alias - Persisted reconciliation alias.
   * @returns Secret for Host storage only; reconcile unknown outcomes before retrying.
   */
  async generateKey(alias: string): Promise<{ readonly key: GatewayKey; readonly apiKey: string }> {
    if (!alias.trim()) throw new Error('Key alias is required')
    const raw = await this.send('POST', '/api/keys/generate', { alias })
    try {
      const result = parse(z.object({ id, key: text, masked_key: text, status: text.optional() }), raw)
      return { key: toKey({ ...result, alias, status: result.status ?? 'active' }), apiKey: result.key }
    } catch { throw new GatewayRequestError('invalid', undefined, 'unknown') }
  }
  /** Read the advertised public endpoint, discarding internal endpoint fields.
   * @returns Public HTTPS model endpoint.
   */
  async readPublicEndpoint(): Promise<string> {
    const result = parse(z.object({ llm_base_url: text }), await this.send('GET', '/api/auth/orgs'))
    try {
      const url = publicHttps(result.llm_base_url)
      if (!this.allowedOrigins.has(url.origin)) throw new Error('Model endpoint is not allowlisted')
      const endpoint = url.href.replace(/\/$/, '')
      this.publicEndpoint = endpoint
      return endpoint
    }
    catch { throw new GatewayRequestError('invalid') }
  }
  /** Read only explicit capability facts from the previously admitted public endpoint.
   * @param baseUrl - Exact endpoint returned by readPublicEndpoint on this scoped client.
   * @param apiKey - Host-only model API key; the identity bearer is never sent to this endpoint.
   * @returns Bounded model records; ID-only records retain unknown capabilities.
   */
  async listEndpointModels(baseUrl: string, apiKey: string): Promise<readonly GatewayModel[]> {
    if (baseUrl !== this.publicEndpoint || !apiKey.trim()) throw new GatewayRequestError('invalid')
    const modalities = z.array(z.enum(['text', 'image', 'video', 'audio', 'pdf'])).min(1).max(5)
      .refine(items => new Set(items).size === items.length)
    const levels = ['disabled', 'enabled', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
    const efforts = z.array(z.enum(levels)).min(1).max(levels.length).refine(items => new Set(items).size === items.length)
    const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
    const item = z.object({
      id: text.max(512).regex(/^[^\x00-\x1f\x7f]+$/),
      context_window: positive.optional(), context_length: positive.optional(), max_output_tokens: positive.optional(),
      input_modalities: modalities.optional(), architecture: z.object({ input_modalities: modalities.optional() }).optional(),
      supports_vision: z.boolean().optional(), supports_tools: z.boolean().optional(), supports_reasoning: z.boolean().optional(),
      reasoning_levels: efforts.optional(), reasoning_effort: efforts.optional(), supported_reasoning_efforts: efforts.optional(),
    })
    const raw = parse(z.object({ data: z.array(z.union([text, item])).max(this.config.maxItems) }),
      await this.send('GET', '', undefined, { url: new URL(`${baseUrl}/models`), apiKey }))
    const models = raw.data.map((value) => {
      const model = parse(item, typeof value === 'string' ? { id: value } : value)
      const contextWindow = model.context_window ?? model.context_length
      const inputModalities = model.input_modalities ?? model.architecture?.input_modalities
      const reasoningLevels = model.reasoning_levels ?? model.reasoning_effort ?? model.supported_reasoning_efforts
      if ((model.context_window !== undefined && model.context_length !== undefined && model.context_window !== model.context_length) ||
        (inputModalities !== undefined && model.supports_vision !== undefined && inputModalities.includes('image') !== model.supports_vision) ||
        (reasoningLevels !== undefined && model.supports_reasoning === false)) throw new GatewayRequestError('invalid')
      return { id: model.id,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(model.max_output_tokens === undefined ? {} : { maxOutputTokens: model.max_output_tokens }),
        ...(inputModalities === undefined ? {} : { inputModalities }),
        ...(model.supports_vision === undefined ? {} : { supportsVision: model.supports_vision }),
        ...(model.supports_tools === undefined ? {} : { supportsTools: model.supports_tools }),
        ...(model.supports_reasoning === undefined ? {} : { supportsReasoning: model.supports_reasoning }),
        ...(reasoningLevels === undefined ? {} : { reasoningLevels: levels.filter(level => reasoningLevels.includes(level)) }),
      }
    })
    if (new Set(models.map(model => model.id)).size !== models.length) throw new GatewayRequestError('invalid')
    return models
  }
  /** Read subscription balances without fallback zeros.
   * @returns Balances with unspecified accounting units.
   */
  async readSubscriptions(): Promise<readonly GatewaySubscription[]> {
    const result = parse(z.object({ subscriptions: z.array(z.object({ plan_id: id, plan_title: text,
      amount_total: count, amount_used: count, next_reset_time: count.nullable().optional(), status: text })).max(this.config.maxItems) }), await this.send('GET', '/api/usage'))
    return result.subscriptions.map(item => ({ planId: item.plan_id, planTitle: item.plan_title,
      amountTotal: item.amount_total, amountUsed: item.amount_used, amountUnit: 'unspecified',
      nextResetTime: item.next_reset_time ?? null, status: item.status }))
  }
  /** Read the server plan restrictions.
   * @returns Plan filters, preserving explicit unrestricted status.
   */
  async readPlanModels(): Promise<GatewayPlanModels> {
    const raw = parse(z.object({ models: z.array(text).max(this.config.maxItems), unrestricted: z.boolean(), hasSubscription: z.boolean() }), await this.send('GET', '/api/usage/models'))
    return { ...raw, models: [...new Set(raw.models)] }
  }
  /** Read validated aggregates for the requested selection.
   * @param input - Requested aggregation.
   * @returns Valid aggregates with explicit unknown cost unit.
   */
  async readUsage(input: UsageRequest): Promise<GatewayUsage> {
    const query = new URLSearchParams({ period: input.period, metric: input.metric, ...(input.force ? { refresh: '1' } : {}) })
    const raw = parse(z.object({ period, metric, from: text, until: text, summary,
      trend: z.array(z.object({ date: text, requestCount: count, cost: z.number(), tokens: count })).max(this.config.maxItems),
      models: z.array(z.object({ model: text, requestCount: count, cost: z.number(), share: z.number() })).max(this.config.maxItems) }), await this.send('GET', `/api/usage/stats?${query}`))
    if (raw.period !== input.period || raw.metric !== input.metric || raw.summary.successCount > raw.summary.requestCount) throw new GatewayRequestError('invalid')
    return { ...raw, costUnit: 'unspecified', summary: { ...raw.summary, successRate: raw.summary.successRate / 100 } }
  }
}
