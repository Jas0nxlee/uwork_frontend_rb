/** Public catalog matching, credential isolation, shared refresh and cancellation. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCatalog } from '../src/public-model-catalog.ts'
import { installPublicModelDiscovery } from '../src/public-model-discovery.ts'

const data = {
  vendor: { id: 'vendor', api: 'https://models.example/v1', models: {
    vision: { reasoning: true, reasoning_options: [{ type: 'effort', values: ['none', 'low', 'high', 'xhigh'] }], id: 'vision', canonical_model_id: 'vendor/vision', limit: { context: 200000, output: 8000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
    text: { reasoning: false, id: 'text', canonical_model_id: 'vendor/text', limit: { context: 100000, output: 4000 }, modalities: { input: ['text'] } },
  } },
}
const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

async function setup(dir?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  if (dir !== undefined) ctx.provide('profileContext', {
    name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: dir,
    cwd: dir, home: dir, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  installPublicModelDiscovery(ctx, { url: 'https://catalog.example/api.json', timeoutMs: 15000, ttlMs: 86400000, retryMs: 300000, maxBytes: 12000000 })
  ctx.llm.registerModelDiscovery('test', request => Promise.resolve((request.modelIds ?? ['vision']).map(id => ({ id }))))
  return ctx
}

it('matches exact endpoints and canonical identities without guessing aliases', () => {
  const catalog = parseCatalog(data)
  expect(catalog.match('https://models.example/v1/', 'vendor/vision')?.model.limit?.context).toBe(200000)
  expect(catalog.match('https://relay.example/v1', 'vision')?.providerId).toBe('vendor')
  expect(catalog.match('https://relay.example/v1', 'vision-latest')).toBeUndefined()
  expect(catalog.match('https://models.example/v1', 'unknown')).toBeUndefined()
  const ambiguous = parseCatalog({ ...data, other: { id: 'other', api: 'https://models.example', models: data.vendor.models } })
  expect(ambiguous.match('https://models.example/v1', 'vision')).toBeUndefined()
  expect(() => parseCatalog({ vendor: { models: { invalid: { limit: { context: -1 } } } } })).toThrow()
})

it('shares one public request, never forwards credentials, and caches text and vision capabilities', async () => {
  const reply = Promise.withResolvers<Response>()
  const fetcher = vi.fn(() => reply.promise)
  vi.stubGlobal('fetch', fetcher)
  const ctx = await setup()
  const first = ctx.llm.discoverModels('test', { baseURL: 'https://private.example', apiKey: 'private-secret', modelIds: ['vision'] })
  const second = ctx.llm.discoverModels('test', { baseURL: 'https://private.example', modelIds: ['text'] })
  await vi.waitFor(() => { expect(fetcher).toHaveBeenCalledTimes(1) })
  reply.resolve(new Response(JSON.stringify(data)))
  expect(await first).toEqual([{ id: 'vision', contextWindow: 200000, maxTokens: 8000, inputModalities: ['text', 'image'], reasoningLevels: ['none', 'low', 'high', 'xhigh'] }])
  expect(await second).toEqual([{ id: 'text', contextWindow: 100000, maxTokens: 4000, inputModalities: ['text'], reasoningLevels: false }])
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('private-secret')
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('private.example')
  await ctx.llm.discoverModels('test', { provider: 'personal', modelIds: ['vision'] })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('keeps missing capabilities unknown on an unavailable directory and backs off retries', async () => {
  const fetcher = vi.fn(() => Promise.reject(new Error('offline')))
  vi.stubGlobal('fetch', fetcher)
  const ctx = await setup()
  for (let i = 0; i < 2; i++) {
    expect(await ctx.llm.discoverModels('test', { provider: 'personal' })).toEqual([{ id: 'vision' }])
  }
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('cancels one waiter without cancelling the shared catalog refresh', async () => {
  const reply = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn(() => reply.promise))
  const ctx = await setup()
  const controller = new AbortController()
  const first = ctx.llm.discoverModels('test', { provider: 'personal' }, controller.signal)
  const rejected = expect(first).rejects.toThrow('cancelled')
  await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
  controller.abort(new Error('cancelled'))
  await rejected
  reply.resolve(new Response(JSON.stringify(data)))
  expect((await ctx.llm.discoverModels('test', { provider: 'personal' }))[0]?.contextWindow).toBe(200000)
})

it('uses a validated last-good disk cache while offline after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uwork-catalog-'))
  directories.push(dir)
  const folder = join(dir, '.model-catalog')
  await mkdir(folder)
  const cache = JSON.stringify({ source: 'https://catalog.example/api.json', fetchedAt: 1, data })
  await writeFile(join(folder, 'models-dev.json'), cache)
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  const ctx = await setup(dir)
  const models = await ctx.llm.discoverModels('test', { provider: 'personal' })
  expect(models[0]?.contextWindow).toBe(200000)
  expect(await readFile(join(folder, 'models-dev.json'), 'utf8')).toBe(cache)
})

it('rejects oversized responses and preserves explicit provider capabilities', async () => {
  const fetcher = vi.fn(() => Promise.resolve(new Response('{}', { headers: { 'content-length': '999999999' } })))
  vi.stubGlobal('fetch', fetcher)
  const ctx = await setup()
  ctx.llm.registerModelDiscovery('complete', () => Promise.resolve([
    { id: 'vision', contextWindow: 32000, maxTokens: 4000, inputModalities: ['text'], reasoningLevels: false },
  ]))
  expect(await ctx.llm.discoverModels('complete', { provider: 'personal' }))
    .toEqual([{ id: 'vision', contextWindow: 32000, maxTokens: 4000, inputModalities: ['text'], reasoningLevels: false }])
  expect(fetcher).not.toHaveBeenCalled()
  expect(await ctx.llm.discoverModels('test', { provider: 'personal' })).toEqual([{ id: 'vision' }])
})

it('fills missing endpoint fields without replacing its declared context limit', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(data)))))
  const ctx = await setup()
  ctx.llm.registerModelDiscovery('partial', () => Promise.resolve([{ id: 'vision', contextWindow: 32000 }]))
  expect(await ctx.llm.discoverModels('partial', { provider: 'personal' }))
    .toEqual([{ id: 'vision', contextWindow: 32000, maxTokens: 8000, inputModalities: ['text', 'image'], reasoningLevels: ['none', 'low', 'high', 'xhigh'] }])
})

it('keeps reasoning levels unknown when the directory discloses only a reasoning flag', async () => {
  const fixture = structuredClone(data)
  fixture.vendor.models.vision.reasoning_options = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(fixture)))))
  const ctx = await setup()
  const models = await ctx.llm.discoverModels('test', { provider: 'personal' })
  expect(models[0]).not.toHaveProperty('reasoningLevels')
})

it('obtains reasoning levels when the endpoint already supplies capacities and input types', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(data)))))
  const ctx = await setup()
  ctx.llm.registerModelDiscovery('capacities', () => Promise.resolve([
    { id: 'vision', contextWindow: 32000, maxTokens: 4000, inputModalities: ['text'] },
  ]))
  expect(await ctx.llm.discoverModels('capacities', { provider: 'personal' })).toEqual([
    { id: 'vision', contextWindow: 32000, maxTokens: 4000, inputModalities: ['text'],
      reasoningLevels: ['none', 'low', 'high', 'xhigh'] },
  ])
})
