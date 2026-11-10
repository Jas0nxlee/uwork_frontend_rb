import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as PiAi from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

declare module '@deepseek-ai/dsh-llm/types' { interface LlmRequestPurposeMap { 'uwork-provisioning-test': true } }

afterEach(async () => { await closeMockServers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
async function harness(baseURL: string) {
  const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(PiAi, { providers: { managed: { api: 'openai-completions', apiKeyEnv: 'UWORK_SIGNAL_KEY', baseURL, models: [{ id: 'm' }] } } })
  return ctx
}
it('denies revoked routes before missing credential resolution or network I/O', async () => {
  const server = await mockServer([{ events: textEvents }]); const ctx = await harness(server.url)
  ctx.on('llm-pi-ai/request-signal', () => { throw new Error('enterprise session revoked') })
  const result = await assemble(ctx, { provider: 'managed', model: 'm', messages: [] })
  expect(result.finish.kind).toBe('error')
  expect(JSON.stringify(result.finish)).toContain('enterprise session revoked')
  expect(server.requests).toHaveLength(0)
})
it('passes unrelated routes through next and removes disposed hooks', async () => {
  vi.stubEnv('UWORK_SIGNAL_KEY', 'fixture')
  const server = await mockServer([{ events: textEvents }, { events: textEvents }]); const ctx = await harness(server.url)
  const remove = ctx.on('llm-pi-ai/request-signal', (request, next) => {
    expect(Object.isFrozen(request)).toBe(true); expect(request.provider).toBe('managed')
    expect(request.purpose).toBe('uwork-provisioning-test'); return next()
  })
  ctx.on('llm-pi-ai/request-headers', (request, _headers, next) => { expect(request.purpose).toBe('uwork-provisioning-test'); return next() })
  expect((await assemble(ctx, { provider: 'managed', model: 'm', messages: [], purpose: 'uwork-provisioning-test' })).finish.kind).toBe('stop')
  remove()
  expect((await assemble(ctx, { provider: 'managed', model: 'm', messages: [], purpose: 'uwork-provisioning-test' })).finish.kind).toBe('stop')
})
it('cancels an in-flight native request with the managed route lifetime', async () => {
  vi.stubEnv('UWORK_SIGNAL_KEY', 'fixture')
  const server = await mockServer([{ holdOpen: true }]); const ctx = await harness(server.url)
  const revoke = new AbortController()
  ctx.on('llm-pi-ai/request-signal', () => revoke.signal)
  const result = assemble(ctx, { provider: 'managed', model: 'm', messages: [] })
  await server.requestReceived; revoke.abort()
  expect((await result).finish.kind).toBe('aborted')
  await server.responseClosed
})
it('classifies an already revoked lifetime as aborted before accessing credentials', async () => {
  const server = await mockServer([{ events: textEvents }]); const ctx = await harness(server.url)
  const revoked = new AbortController(); revoked.abort()
  ctx.on('llm-pi-ai/request-signal', () => revoked.signal)
  const result = await assemble(ctx, { provider: 'managed', model: 'm', messages: [] })
  expect(result.finish.kind).toBe('aborted'); expect(server.requests).toHaveLength(0)
})
it.each([false, true])('composes discovery authorization lifetime with caller=%s without exposing the one-shot key', async (caller) => {
  const ctx = await harness('https://models.example/v1')
  const lifetime = new AbortController()
  const fetchModels = vi.fn(async () => Response.json({ data: [{ id: 'advertised' }] }))
  vi.stubGlobal('fetch', fetchModels)
  ctx.on('llm-pi-ai/discovery-signal', (request, next) => {
    expect(Object.isFrozen(request)).toBe(true)
    expect(request).toEqual({ provider: 'managed', baseURL: 'https://models.example/v1', api: 'openai-completions' })
    expect(next()).toBeUndefined()
    return lifetime.signal
  })
  expect(await ctx.llm.discoverModels('llm-pi-ai', { provider: 'managed', baseURL: 'https://models.example/v1',
    api: 'openai-completions', apiKey: 'one-shot' }, caller ? new AbortController().signal : undefined)).toEqual([{ id: 'advertised', name: 'advertised' }])
  lifetime.abort()
  await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'managed', baseURL: 'https://models.example/v1',
    api: 'openai-completions', apiKey: 'one-shot' })).rejects.toThrow()
  expect(fetchModels).toHaveBeenCalledOnce()
})
