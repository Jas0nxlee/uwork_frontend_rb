/** Synthetic issuer and gateway responses; all Host services and credential persistence are real. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Authorization from '@deepseek-ai/dsh-authorization'
import NativeAuthorization from '@deepseek-ai/dsh-native-authorization'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import EnterpriseIdentity from '@deepseek-ai/dsh-uwork-enterprise'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import GatewayService from '../src/index.ts'

const signal = () => new AbortController().signal
const contexts: Context[] = []
const directories: string[] = []
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const stats = (period = '7d', metric = 'requests') => ({ period, metric, from: '2026-11-01', until: '2026-11-07', summary: { requestCount: 10, successCount: 9, successRate: 90, cost: 2, averageCost: .2, promptTokens: 15, completionTokens: 5, totalTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 }, trend: [], models: [] })
let user = 'synthetic-user'
function external() {
  user = 'synthetic-user'
  const request = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url)
    switch (url.pathname) {
      case '/api/auth/handoff/start': return response({ handoff_id: 'synthetic-handoff', handoff_secret: 'synthetic-private-secret', expires_at: new Date(Date.now() + 60000).toISOString() }, 201)
      case '/api/auth/login':
      case '/api/auth/refresh': return response({ token: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.synthetic-signature`, user: { id: user, org_id: 'synthetic-org', name: 'Synthetic employee' } })
      case '/api/auth/orgs': return response({ llm_base_url: 'https://models.example.com/v1', llm_base_url_internal: 'http://10.0.0.1/v1' })
      case '/api/keys': return response({ keys: [{ id: 1, alias: 'synthetic-alias', masked_key: 'synthetic-mask', status: 'active' }] })
      case '/api/usage': return response({ subscriptions: [] })
      case '/api/usage/models': return response({ models: ['synthetic-model'], unrestricted: false, hasSubscription: true })
      case '/api/usage/stats': return response(stats(url.searchParams.get('period')!, url.searchParams.get('metric')!))
      default: throw new Error('Unexpected synthetic endpoint')
    }
  })
  vi.stubGlobal('fetch', request)
  return request
}
async function harness(cacheTtlMs = 30000, loader = false) {
  const ctx = new Context()
  contexts.push(ctx)
  const directory = await mkdtemp(join(tmpdir(), 'gateway-service-test-'))
  directories.push(directory)
  await ctx.plugin(CredentialsLocal, { path: join(directory, 'credentials.yaml'), watch: false })
  await ctx.plugin(Authorization)
  await ctx.plugin(NativeAuthorization)
  await ctx.plugin(EnterpriseIdentity, { apiBaseUrl: 'https://issuer.example.com', organizations: [{ orgId: 'synthetic-org', corpId: 'synthetic-corp', agentId: '123', callbackUrl: 'https://issuer.example.com/callback' }], defaultOrgId: 'synthetic-org' })
  const config = { apiBaseUrl: 'https://issuer.example.com', allowedModelEndpointOrigins: ['https://models.example.com'], cacheTtlMs }
  if (loader) {
    await ctx.plugin(Loader)
    ctx.loader.builtins['gateway-service'] = GatewayService
    await ctx.loader.create({ name: 'cordis:gateway-service', config })
    await ctx.loader.await()
  } else await ctx.plugin(GatewayService, config)
  return ctx
}
async function login(ctx: Context) {
  const attempt = await ctx.uworkIdentity.startSignIn('synthetic-org')
  const callback = new URL(attempt.callbackUrl)
  callback.searchParams.set('code', 'synthetic-private-code')
  callback.searchParams.set('state', 'synthetic-org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback.href)
}
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.unstubAllGlobals()
})

it('does not issue gateway requests while signed out, including the real Loader composition', async () => {
  const request = external()
  const ctx = await harness(30000, true)
  expect(ctx.get('uworkGateway')).toBeDefined()
  expect(await ctx.uworkGateway.getOverview(signal())).toEqual({ status: 'signed-out' })
  expect(await ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests' }, signal())).toEqual({ status: 'signed-out' })
  expect(request).not.toHaveBeenCalled()
})
it('projects only safe overview fields and refreshes model permissions explicitly', async () => {
  const request = external()
  const ctx = await harness()
  await login(ctx)
  const first = await ctx.uworkGateway.getOverview(signal())
  expect(first).toMatchObject({ status: 'ready', data: { publicEndpoint: 'https://models.example.com/v1', keys: [{ maskedKey: 'synthetic-mask' }], planModels: { models: ['synthetic-model'] } }, binding: { userId: user } })
  expect(JSON.stringify(first)).not.toMatch(/token|10\.0\.0\.1|private-secret/)
  const calls = request.mock.calls.length
  expect(await ctx.uworkGateway.getOverview(signal())).toEqual(first)
  expect(request).toHaveBeenCalledTimes(calls)
  expect(await ctx.uworkGateway.refreshModels(signal())).toMatchObject({ status: 'ready' })
  expect(request).toHaveBeenCalledTimes(calls + 4)
})
it('isolates period and metric caches and retains last successful values on failure', async () => {
  const request = external()
  const ctx = await harness()
  await login(ctx)
  const first = await ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests' }, signal())
  await ctx.uworkGateway.readUsage({ period: 'month', metric: 'tokens' }, signal())
  const calls = request.mock.calls.length
  expect(await ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests' }, signal())).toEqual(first)
  expect(request).toHaveBeenCalledTimes(calls)
  request.mockResolvedValue(response({}, 429))
  expect(await ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests', force: true }, signal())).toMatchObject({ status: 'error', reason: 'rate-limited', lastSuccess: { data: { summary: { requestCount: 10 } } } })
})
it('has no fallback zeros when the first read fails', async () => {
  const request = external()
  const ctx = await harness(0)
  await login(ctx)
  request.mockResolvedValue(response({}, 403))
  expect(await ctx.uworkGateway.getOverview(signal())).toEqual({ status: 'error', reason: 'forbidden' })
})
it('rejects cancelled and malformed queries before fetching', async () => {
  const request = external()
  const ctx = await harness()
  const controller = new AbortController()
  controller.abort()
  await expect(ctx.uworkGateway.getOverview(controller.signal)).rejects.toMatchObject({ code: 'uwork-gateway/cancelled' })
  await expect(Reflect.apply(ctx.uworkGateway.readUsage.bind(ctx.uworkGateway), undefined, [{ period: 'invalid', metric: 'requests' }, signal()])).rejects.toMatchObject({ code: 'uwork-gateway/invalid-query' })
  expect(request).not.toHaveBeenCalled()
})
it('cancels an obsolete filter and never returns its late result', async () => {
  const request = external()
  const ctx = await harness()
  await login(ctx)
  const firstRead = Promise.withResolvers<Response>()
  request.mockImplementationOnce(() => firstRead.promise)
  const old = ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests' }, signal())
  const rejected = expect(old).rejects.toMatchObject({ code: 'uwork-gateway/cancelled' })
  await vi.waitFor(() =>{  expect(request.mock.calls.some(([input]) => (input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).includes('/api/usage/stats'))).toBe(true) })
  expect(await ctx.uworkGateway.readUsage({ period: 'month', metric: 'tokens' }, signal())).toMatchObject({ status: 'ready', data: { period: 'month', metric: 'tokens' } })
  firstRead.resolve(response(stats()))
  await rejected
})
it('clears former identity observations on sign-out and account replacement', async () => {
  external()
  const ctx = await harness()
  await login(ctx)
  await ctx.uworkGateway.getOverview(signal())
  await ctx.uworkIdentity.signOut()
  expect(await ctx.uworkGateway.getOverview(signal())).toEqual({ status: 'signed-out' })
  user = 'synthetic-other-user'
  await login(ctx)
  expect(await ctx.uworkGateway.getOverview(signal())).toMatchObject({ status: 'ready', binding: { userId: 'synthetic-other-user' } })
})
it('reports identity verification failures without exposing persisted or previous data', async () => {
  const request = external()
  const ctx = await harness()
  await ctx.credentials.modifyRecord(credentialKey('uwork-enterprise', 'identity'), async () => ({
    kind: 'grant', payload: { version: 1, state: 'session', orgId: 'synthetic-org', userId: 'synthetic-user', generation: 'synthetic-generation', token: 'synthetic-stored-token' },
  }))
  request.mockResolvedValue(response({}, 500))
  expect(await ctx.uworkGateway.getOverview(signal())).toEqual({ status: 'error', reason: 'identity' })
})
it('rejects a late successful response after external generation revocation', async () => {
  const request = external()
  const ctx = await harness()
  await login(ctx)
  const delayed = Promise.withResolvers<Response>()
  request.mockImplementationOnce(() => delayed.promise)
  const work = ctx.uworkGateway.readUsage({ period: '7d', metric: 'requests' }, signal())
  await vi.waitFor(() =>{  expect(request.mock.calls.some(([input]) => (input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).includes('/api/usage/stats'))).toBe(true) })
  await ctx.credentials.modifyRecord(credentialKey('uwork-enterprise', 'identity'), async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: 'synthetic-revoked' } }))
  delayed.resolve(response(stats()))
  const outcome = await work.catch((error: unknown) => {
    expect(error).toMatchObject({ code: 'uwork-gateway/cancelled' })
    return { status: 'error', reason: 'identity' } as const
  })
  expect(outcome).toEqual({ status: 'error', reason: 'identity' })
})
it('streams initial identity and account changes, releasing subscription on cancellation', async () => {
  external()
  const ctx = await harness()
  const controller = new AbortController()
  const iterator = ctx.uworkGateway.watchIdentity(controller.signal)[Symbol.asyncIterator]()
  expect(await iterator.next()).toMatchObject({ value: null, done: false })
  await login(ctx)
  expect(await iterator.next()).toMatchObject({ value: { userId: 'synthetic-user' }, done: false })
  const signedOut = iterator.next()
  await ctx.uworkIdentity.signOut()
  expect(await signedOut).toMatchObject({ value: null, done: false })
  const ended = iterator.next()
  controller.abort()
  expect(await ended).toMatchObject({ done: true })
})
