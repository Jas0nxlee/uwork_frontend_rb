/** Protocol rejection and anonymous browsing through the owning service. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { normalizeSource } from '../src/catalog.ts'
import CompanyMarket, { type Config } from '../src/index.ts'

const source = 'https://market.example/skillhub'
const skill = (slug = 'weather') => ({ slug, displayName: `Title ${slug}`, summary: `Summary ${slug}`, latestVersion: { version: '1.0.0' } })
const json = (value: unknown) => new Response(JSON.stringify(value))
const signal = () => new AbortController().signal

afterEach(() => { vi.unstubAllGlobals() })

async function mount(config: Partial<Config> = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(CompanyMarket, { baseUrl: source, ...config }).await()
  return { ctx, market: ctx.get('uworkCompanyMarket')! }
}

function respond(pages: unknown[], discovery: unknown = { apiBase: '/skillhub/api/v1' }) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/.well-known/clawhub.json')) return json(discovery)
    const page = Number(new URL(url).searchParams.get('page'))
    return json(pages[page])
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('company catalog', () => {
  it('discovers the configured root, follows all pages and searches title, slug and summary anonymously', async () => {
    const fetcher = respond([
      { items: [], nextCursor: '1' },
      { items: [skill('weather'), skill('video-frames')], nextCursor: 2 },
      { items: [skill('global--archive')], nextCursor: null },
    ])
    const { market } = await mount({ resultPageSize: 1 })
    const first = await market.search('', 0, signal())
    expect(first).toMatchObject({ source, total: 3, page: 0, nextPage: 1, items: [{ slug: 'weather', version: '1.0.0' }] })
    expect(await market.search('VIDEO', 0, signal())).toMatchObject({ total: 1, nextPage: null, items: [{ slug: 'video-frames' }] })
    expect(await market.search('Summary weather', 0, signal())).toMatchObject({ total: 1 })
    expect(await market.search('Title global', 0, signal())).toMatchObject({ total: 1 })
    expect(await market.search('missing', 0, signal())).toMatchObject({ total: 0, items: [], nextPage: null })
    expect(await market.search('', 2, signal())).toMatchObject({ page: 2, nextPage: null, items: [{ slug: 'global--archive' }] })
    for (const [url, options] of fetcher.mock.calls) {
      expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toMatch(/^https:\/\/market.example\/skillhub\//u)
      expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' } })
      expect(options?.headers).not.toHaveProperty('authorization')
    }
  })

  it.each([
    [{ items: [], nextCursor: 0 }],
    [{ items: [skill(), skill()], nextCursor: null }],
    [{ items: [skill()], nextCursor: 1 }, { items: [skill()], nextCursor: null }],
    [{ items: [], nextCursor: '' }],
    [{ items: [], nextCursor: -1 }],
    [{ items: [], nextCursor: '9007199254740993' }],
    [{ items: [{ ...skill(), slug: '../escape' }], nextCursor: null }],
    [{ items: [{ ...skill(), latestVersion: { version: '../1' } }], nextCursor: null }],
    [{ items: [] }],
  ])('refuses malformed, repeated or cyclic catalog data: %j', async (...pages) => {
    respond(pages)
    const { market } = await mount()
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ code: 'uwork-company-market/unavailable', details: { reason: 'invalid' } })
  })

  it.each([
    {}, { apiBase: 'https://other.example/api/v1' }, { apiBase: 'https://user@market.example/api/v1' },
    { apiBase: '/api/v1#fragment' }, { apiBase: '/api/v1?key=x' }, { apiBase: 'https://%' },
  ])('rejects invalid discovery without contacting its declared source: %j', async (discovery) => {
    const fetcher = respond([], discovery)
    const { market } = await mount()
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'invalid' } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    { maxPages: 1 }, { maxItems: 1 }, { maxResponseBytes: 1 },
  ])('rejects incomplete or oversized catalogs rather than silently truncating: %j', async (limits) => {
    respond([{ items: [skill(), skill('other')], nextCursor: 1 }, { items: [], nextCursor: null }])
    const { market } = await mount(limits)
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
  })

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rate-limited'], [500, 'http']] as const)(
    'classifies HTTP %i without exposing its response body', async (status, reason) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('private diagnostic', { status })))
      const { market } = await mount()
      await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason, status } })
    })

  it.each([new Response('not JSON'), new Response(null)])('rejects invalid and absent JSON bodies', async (response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const { market } = await mount()
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'invalid' } })
  })

  it('bounds streamed bytes including multibyte text', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ apiBase: '/api/v1', extra: '企业' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(body.slice(0, 10)); controller.enqueue(body.slice(10)); controller.close() },
    }))))
    const { market } = await mount({ maxResponseBytes: body.length - 1 })
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
  })

  it.each([['x'.repeat(513), 0], ['', -1], ['', 0.5], ['', Number.MAX_SAFE_INTEGER + 1]])(
    'rejects invalid search input before making a request', async (text, page) => {
      const fetcher = respond([])
      const { market } = await mount()
      await expect(market.search(text, page, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-query' })
      expect(fetcher).not.toHaveBeenCalled()
    })

  it('rejects an out-of-range result page and unsafe offset', async () => {
    respond([{ items: [], nextCursor: null }])
    const { market } = await mount()
    for (const page of [1, Number.MAX_SAFE_INTEGER]) {
      await expect(market.search('', page, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-query' })
    }
  })

  it('classifies a network refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    const { market } = await mount()
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'network' } })
  })

  it('reports the configured catalog deadline as a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, options) => await new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => { reject(new Error('deadline')) }, { once: true })
    })))
    const { market } = await mount({ timeoutMs: 1 })
    await expect(market.search('', 0, signal())).rejects.toMatchObject({ details: { reason: 'network' } })
  })

  it.each(['caller', 'dispose'] as const)('cancels in-flight transport on %s and waits for it to settle', async (action) => {
    const started = Promise.withResolvers<undefined>()
    let requestSignal: AbortSignal | null = null
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, options) => {
      requestSignal = options?.signal ?? null
      started.resolve(undefined)
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => { reject(new Error('request aborted')) }, { once: true })
      })
    }))
    const { ctx, market } = await mount()
    const caller = new AbortController()
    const request = market.search('', 0, caller.signal)
    const rejected = expect(request).rejects.toThrow()
    await started.promise
    if (action === 'caller') caller.abort()
    else await ctx.fiber.dispose()
    await rejected
  })
})

describe('source configuration', () => {
  it.each(['https://market.example/skillhub/', 'http://localhost:1234/', 'http://127.0.0.1:1234/', 'http://[::1]:1234/'])('normalizes an allowed source: %s', (value) => {
    expect(normalizeSource(value)).toBe(value.replace(/\/+$/u, ''))
  })
  it.each(['http://market.example', 'file:///tmp/catalog', 'https://user:pass@market.example', 'https://market.example?secret=x', 'https://market.example/#x', 'invalid'])('rejects an invalid source before mounting: %s', (value) => {
    expect(() => normalizeSource(value)).toThrow()
  })
})
