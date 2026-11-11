/** Host-owned public model metadata cache, independent of enterprise credentials. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { readFile, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseCatalog, type CatalogIndex } from './public-model-catalog.ts'

/** Deployment-owned public catalog settings. No provider credential is accepted. */
export interface PublicModelCatalogConfig {
  /** HTTPS directory endpoint. */
  url: string
  /** Maximum response and cache size in bytes. */
  maxBytes: number
  /** Fetch deadline in milliseconds. */
  timeoutMs: number
  /** Freshness interval in milliseconds. */
  ttlMs: number
  /** Failed-refresh retry interval in milliseconds. */
  retryMs: number
}

/** Install lifetime-owned discovery enrichment with a last-good per-profile cache.
 * @param ctx - plugin scope owning the listener and pending requests.
 * @param config - validated public directory settings.
 */
export function installPublicModelDiscovery(ctx: Context, config: PublicModelCatalogConfig): void {
  const url = new URL(config.url)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Public model catalog requires an HTTPS URL without credentials or query parameters')
  }
  const lifetime = new AbortController()
  const profile = ctx.get('profileContext')
  const cacheFile = profile === undefined ? undefined : join(profile.dir, '.model-catalog', 'models-dev.json')
  let snapshot: CatalogIndex | undefined
  let fetchedAt = 0
  let retryAfter = 0
  let pending: Promise<CatalogIndex | undefined> | undefined
  let loaded = false

  const refresh = async (): Promise<CatalogIndex | undefined> => {
    if (!loaded) {
      loaded = true
      if (cacheFile !== undefined) {
        try {
          const text = await readFile(cacheFile, 'utf8')
          if (Buffer.byteLength(text) > config.maxBytes) throw new Error('Cached catalog exceeds size limit')
          const cached: unknown = JSON.parse(text)
          if (cached === null || typeof cached !== 'object' || !('source' in cached) || cached.source !== config.url
            || !('fetchedAt' in cached) || typeof cached.fetchedAt !== 'number' || !Number.isFinite(cached.fetchedAt)
            || cached.fetchedAt > Date.now() || !('data' in cached)) throw new Error('Invalid cached catalog')
          snapshot = parseCatalog(cached.data)
          fetchedAt = cached.fetchedAt
        } catch (error) {
          // The public cache is disposable; an invalid or absent file requires a network refresh.
          ctx.logger.debug('Public model cache unavailable: %s', error instanceof Error ? error.message : String(error))
        }
      }
    }
    if (snapshot !== undefined && Date.now() - fetchedAt < config.ttlMs) return snapshot
    if (Date.now() < retryAfter) return snapshot
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.timeoutMs)])
    try {
      const response = await fetch(config.url, { signal, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Public model catalog returned HTTP ${response.status}`)
      }
      if (Number(response.headers.get('content-length')) > config.maxBytes) {
        await response.body?.cancel()
        throw new Error('Public model catalog exceeds size limit')
      }
      if (response.body === null) throw new Error('Public model catalog has no body')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > config.maxBytes) throw new Error('Public model catalog exceeds size limit')
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel()
      }
      const next = parseCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      lifetime.signal.throwIfAborted()
      snapshot = next
      fetchedAt = Date.now()
      if (cacheFile !== undefined) {
        const temporary = `${cacheFile}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(cacheFile), { recursive: true })
          await writeFile(temporary, JSON.stringify({ source: config.url, fetchedAt, data: next.data }), { flag: 'wx' })
          await rename(temporary, cacheFile)
        } catch (error) {
          ctx.logger.warn('Could not persist public model catalog: %s', error instanceof Error ? error.message : String(error))
        } finally {
          await rm(temporary, { force: true })
        }
      }
      return snapshot
    } catch (error) {
      retryAfter = Date.now() + config.retryMs
      ctx.logger.warn('Public model catalog refresh failed: %s', error instanceof Error ? error.message : String(error))
      return snapshot
    }
  }
  ctx.on('llm/discover-models', async (request, signal, next) => {
    const models = await next()
    if (models.length === 0 || models.every(model => model.contextWindow !== undefined
      && model.maxTokens !== undefined && model.inputModalities !== undefined && model.reasoningLevels !== undefined)) return models
    signal?.throwIfAborted()
    lifetime.signal.throwIfAborted()
    pending ??= refresh().finally(() => { pending = undefined })
    const active = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
    let cancel: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      cancel = () => { reject(active.reason instanceof Error ? active.reason : new Error('Model discovery cancelled')) }
      active.addEventListener('abort', cancel, { once: true })
      if (active.aborted) cancel()
    })
    let catalog: CatalogIndex | undefined
    try {
      catalog = await Promise.race([pending, aborted])
    } finally {
      if (cancel !== undefined) active.removeEventListener('abort', cancel)
    }
    signal?.throwIfAborted()
    lifetime.signal.throwIfAborted()
    return models.map((model): LlmDiscoveredModel => {
      const match = catalog?.match(request.baseURL ?? '', model.id)?.model
      if (match === undefined) return model
      const input = match.modalities?.input?.flatMap(value =>
        value === 'text' || value.startsWith('text/') ? ['text' as const]
          : value === 'image' || value.startsWith('image/') ? ['image' as const] : [])
      const levels = match.reasoning_options?.flatMap(option => option.values)
      const reasoningLevels = match.reasoning === false ? false
        : levels?.some(level => level !== 'none') ? levels : undefined
      return {
        ...model,
        ...model.contextWindow !== undefined || !match.limit?.context ? {} : { contextWindow: match.limit.context },
        ...model.maxTokens !== undefined || !match.limit?.output ? {} : { maxTokens: match.limit.output },
        ...model.inputModalities !== undefined || !input?.length ? {} : { inputModalities: input },
        ...model.reasoningLevels !== undefined || reasoningLevels === undefined ? {} : { reasoningLevels },
      }
    })
  })
  ctx.effect(() => async () => {
    lifetime.abort()
    await pending
  })
}
