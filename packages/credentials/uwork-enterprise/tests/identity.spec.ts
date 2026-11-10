import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Authorization from '@deepseek-ai/dsh-authorization'
import NativeAuthorization from '@deepseek-ai/dsh-native-authorization'
import type { NativeAuthorizationAttemptId } from '@deepseek-ai/dsh-native-authorization/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CredentialProvider, credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord, CredentialKey, CredentialRef } from '@deepseek-ai/dsh-credentials'
import EnterpriseIdentity from '../src/index.ts'
import { parseConfiguration, parseHandoff, parseIdentity, request } from '../src/protocol.ts'

const config = { apiBaseUrl: 'https://issuer.example', organizations: [{ orgId: 'org', corpId: 'corp-id', agentId: '123', callbackUrl: 'https://callback.example/callback', label: 'Organization' }], defaultOrgId: 'org', observationIntervalMs: 10 }
const key = credentialKey('uwork-enterprise', 'identity')
const token = (user = 'user') => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, user })).toString('base64url')}.signature`
const auth = (user = 'user', org = 'org') => ({ token: token(user), user: { id: user, org_id: org, name: 'Employee' } })
const reply = (body: unknown, status = 200) => new Response(
  status === 202 || status === 404 || status === 500 || status === 401 ? null : JSON.stringify(body), { status },
)

/** An atomic external-store double; no credential protocol or issuer is mocked inside the plugin. */
class Memory extends CredentialProvider {
  record: CredentialRecord | undefined
  private writes: Promise<unknown> = Promise.resolve()
  override resolve(_ref: CredentialRef) { return Promise.resolve(undefined) }
  override describe(_ref: CredentialRef) { return Promise.resolve({ configured: false, writable: true }) }
  override set(_ref: CredentialRef, _value: string) { return Promise.resolve() }
  override unset(_ref: CredentialRef) { return Promise.resolve() }
  override readRecord(_key: CredentialKey) { return Promise.resolve(this.record) }
  override describeRecord(_key: CredentialKey) { return Promise.resolve({ configured: this.record !== undefined, writable: true }) }
  override listRecords() { return Promise.resolve([]) }
  override deleteRecord(_key: CredentialKey) { this.record = undefined; return Promise.resolve() }
  override modifyRecord(_key: CredentialKey, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const operation = this.writes.then(async () => {
      const next = await mutate(this.record)
      if (next !== undefined) { this.record = next; this.notifyRecordUpdated(_key) }
      return this.record
    })
    this.writes = operation.catch(() => {})
    return operation
  }
}
const contexts: Context[] = []
async function harness(overrides: { pollIntervalMs?: number } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Memory).await()
  await ctx.plugin(Authorization).await()
  await ctx.plugin(NativeAuthorization).await()
  await ctx.plugin(EnterpriseIdentity, { ...config, ...overrides }).await()
  return ctx
}
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function callback(attempt: { callbackUrl: string }) { const url = new URL(attempt.callbackUrl); url.searchParams.set('code', 'private-code'); url.searchParams.set('state', 'org'); return url.href }
function targetPath(input: Parameters<typeof fetch>[0]): string {
  return new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).pathname
}
function issuer() {
  const mock = vi.fn<typeof fetch>(async (input) => {
    const path = targetPath(input)
    if (path === '/api/auth/handoff/start') return reply({ handoff_id: 'handoff-test', handoff_secret: 'synthetic-private-secret', expires_at: new Date(Date.now() + 60000).toISOString() }, 201)
    if (path === '/api/auth/handoff/claim') return reply(null, 202)
    return reply(auth())
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

it('strictly validates configuration and callback allowlists', () => {
  expect(parseConfiguration(config).apiBaseUrl).toBe('https://issuer.example/')
  for (const invalid of [ { ...config, extra: 1 }, { ...config, apiBaseUrl: 'http://issuer.example' }, { ...config, apiBaseUrl: 'https://issuer.example/path' }, { ...config, defaultOrgId: 'other' }, { ...config, organizations: [...config.organizations, ...config.organizations] }, { ...config, organizations: [{ ...config.organizations[0], callbackUrl: 'https://callback.example/path?injected=1' }] }, { ...config, requestTimeoutMs: 0 } ]) expect(() => parseConfiguration(invalid)).toThrow()
})
it('validates issuer organization, JWT expiry and handoff bounds', () => {
  expect(parseIdentity(auth(), 'org', Date.now()).userId).toBe('user')
  expect(parseIdentity({ ...auth(), user: { id: 123, org_id: 'org', name: 'Name' } }, 'org', Date.now()).userId).toBe('123')
  for (const input of [ {}, auth('user', 'other'), { ...auth(), token: 'secret' }, { ...auth(), token: 'e30.e30.sig' } ]) expect(() => parseIdentity(input, 'org', Date.now())).toThrow()
  expect(() => parseIdentity(auth(), 'org', Date.now() + 86400000)).toThrow()
  expect(parseHandoff({ handoff_id: 'id', handoff_secret: 'synthetic', expires_at: (Date.now() + 60000) / 1000 }, Date.now(), Date.now() + 1000).expiresAt).toBeLessThanOrEqual(Date.now() + 1000)
  expect(() => parseHandoff({}, Date.now(), Date.now() + 1000)).toThrow()
  expect(() => parseHandoff({ handoff_id: 'id', handoff_secret: 'secret', expires_at: 1 }, Date.now(), Date.now() + 1000)).toThrow()
})
it('isolates handoff secrets, binds native callback and exposes only safe state', async () => {
  const fetchMock = issuer()
  const ctx = await harness()
  const api = ctx.uworkIdentity
  expect(await api.getState()).toEqual({ status: 'signed-out' })
  const attempt = await api.startSignIn('org')
  expect(attempt.id).toBe('handoff-test')
  const query = new URL(attempt.authorizationUrl).searchParams
  expect(query.get('state')).toBe('org')
  expect(new URL(query.get('redirect_uri')!).searchParams.get('uwork_nonce')).toBe(attempt.id)
  expect(JSON.stringify(attempt)).not.toContain('synthetic-private-secret')
  expect(await api.pollSignIn(attempt.id)).toEqual({ status: 'signed-out' })
  expect(fetchMock.mock.calls.some(([input, init]) => targetPath(input).endsWith('/handoff/claim') && typeof init?.body === 'string' && init.body.includes('synthetic-private-secret'))).toBe(true)
  const state = await api.completeSignIn(attempt.id, callback(attempt))
  expect(state.status).toBe('authenticated')
  expect(JSON.stringify(state)).not.toContain('token')
  expect(await api.withSession(async value => ({ org: value.orgId, token: value.token }))).toEqual({ org: 'org', token: token() })
  await expect(api.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: 'STALE' })
  expect((await ctx.credentials.readRecord(key))?.kind).toBe('grant')
})
it('rejects wrong nonce, duplicate state, path, origin and absent code before exchanging', async () => {
  const fetchMock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await expect(ctx.uworkIdentity.completeSignIn(attempt.id, 'not-a-url')).rejects.toMatchObject({ reason: 'CALLBACK' })
  for (const mutate of [ (url: URL) =>{  url.searchParams.set('uwork_nonce', 'wrong') }, (url: URL) =>{  url.searchParams.append('state', 'org') }, (url: URL) => { url.pathname = '/wrong' }, (url: URL) => { url.host = 'evil.example' }, (url: URL) =>{  url.searchParams.delete('code') }, (url: URL) => { url.hash = 'code=other' } ]) {
    const url = new URL(callback(attempt)); mutate(url)
    await expect(ctx.uworkIdentity.completeSignIn(attempt.id, url.href)).rejects.toMatchObject({ reason: 'CALLBACK' })
  }
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('fallback is limited to positively unsupported handoff; network and 5xx stay visible', async () => {
  const ctx = await harness()
  vi.stubGlobal('fetch', vi.fn(async () => reply(null, 404)))
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  expect(await ctx.uworkIdentity.pollSignIn(attempt.id)).toEqual({ status: 'signed-out' })
  vi.stubGlobal('fetch', vi.fn(async () => reply(null, 500)))
  await expect(ctx.uworkIdentity.startSignIn('org')).rejects.toMatchObject({ reason: 'HTTP', details: { status: 500 } })
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('synthetic-private-token') }))
  await expect(ctx.uworkIdentity.startSignIn('org')).rejects.toMatchObject({ reason: 'NETWORK' })
  await expect(ctx.uworkIdentity.startSignIn('unknown')).rejects.toMatchObject({ reason: 'CONFIG' })
})
it('consumes a callback submission once even when the issuer fails', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  mock.mockResolvedValue(reply(null, 500))
  await expect(ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: 'HTTP' })
  await expect(ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: 'STALE' })
})
it('logout aborts active Host work and withdraws authentication', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const work = ctx.uworkIdentity.withSession(async (session) => {
    entered()
    await new Promise<void>((resolve) =>{  session.signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    return 'obsolete'
  })
  await ready
  await ctx.uworkIdentity.signOut()
  await expect(work).rejects.toMatchObject({ reason: 'STALE' })
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
  await expect(ctx.uworkIdentity.withSession(async () => 1)).rejects.toMatchObject({ reason: 'UNAUTHORIZED' })
})
it('rejects a late sign-in writer after another generation has revoked it', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  let deliver!: (response: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve }))
  const completion = ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  await vi.waitFor(() =>{  expect(deliver).toBeTypeOf('function') })
  await ctx.uworkIdentity.signOut()
  deliver(reply(auth()))
  await expect(completion).rejects.toBeDefined()
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('restores stored grants only after server verification and matching user', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  expect((await ctx.uworkIdentity.restoreSession()).status).toBe('authenticated')
  vi.stubGlobal('fetch', vi.fn(async () => reply(auth('other-user'))))
  await expect(ctx.uworkIdentity.restoreSession()).rejects.toMatchObject({ reason: 'PROTOCOL' })
  vi.stubGlobal('fetch', vi.fn(async () => reply(null, 401)))
  expect(await ctx.uworkIdentity.restoreSession()).toEqual({ status: 'signed-out' })
})
it('observes cross-process tombstones and revokes old capabilities', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('native provider is private, selectable, cancellable and disposed with its plugin', async () => {
  issuer()
  const ctx = await harness()
  const provider = ctx.nativeAuthorization.getProvider()!
  const changes: unknown[] = []
  ctx.on('native-authorization/changed', (state) => { changes.push(state) })
  expect((await provider.getState()).status).toBe('signed-out')
  const attempt = await provider.start('org', new AbortController().signal)
  expect((await provider.getState()).status).toBe('pending')
  expect((await provider.poll(attempt.id, new AbortController().signal)).status).toBe('pending')
  expect((await provider.cancel(attempt.id)).status).toBe('signed-out')
  expect(changes).toEqual([expect.objectContaining({ status: 'pending' }), expect.objectContaining({ status: 'signed-out' })])
  expect(JSON.stringify(changes)).not.toMatch(/private|authorizationUrl|callbackUrl|token/)
  expect((await provider.cancel(attempt.id)).status).toBe('signed-out')
})
it('bounds responses and never incorporates upstream bodies in diagnostics', async () => {
  const options = parseConfiguration(config)
  for (const [response, reason] of [ [new Response('not-json'), 'PROTOCOL'], [new Response('x'.repeat(70000)), 'PROTOCOL'], [new Response(null), 'PROTOCOL'] ] as const) {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(request(options, '/api/auth/login', {}, new AbortController().signal)).rejects.toMatchObject({ reason })
  }
})
it('accepts the handoff completion only after refresh and rejects changed issuer users', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  mock.mockResolvedValueOnce(reply(auth())).mockResolvedValueOnce(reply(auth('wrong-user')))
  await expect(ctx.uworkIdentity.pollSignIn(attempt.id)).rejects.toMatchObject({ reason: 'PROTOCOL' })
  mock.mockResolvedValueOnce(reply(auth())).mockResolvedValueOnce(reply(null, 401))
  await expect(ctx.uworkIdentity.pollSignIn(attempt.id)).rejects.toMatchObject({ reason: 'UNAUTHORIZED' })
  mock.mockResolvedValueOnce(reply(null, 500))
  await expect(ctx.uworkIdentity.pollSignIn(attempt.id)).rejects.toMatchObject({ reason: 'HTTP' })
  mock.mockImplementation(async () => reply(auth()))
  expect((await ctx.uworkIdentity.pollSignIn(attempt.id)).status).toBe('authenticated')
})
it('expires attempts and withdraws superseded attempts before any code exchange', async () => {
  issuer()
  const ctx = await harness()
  const first = await ctx.uworkIdentity.startSignIn('org')
  const second = await ctx.uworkIdentity.startSignIn('org')
  await expect(ctx.uworkIdentity.pollSignIn(first.id + '-obsolete')).rejects.toMatchObject({ reason: 'STALE' })
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 86400000)
  await expect(ctx.uworkIdentity.pollSignIn(second.id)).rejects.toMatchObject({ reason: 'EXPIRED' })
})
it('rejects corrupt stored records and allows explicit logout recovery', async () => {
  const ctx = await harness()
  for (const record of [ { kind: 'api-key', key: 'private-synthetic' }, { kind: 'grant', payload: { unexpected: 'private-synthetic' } } ] as const) {
    await ctx.credentials.modifyRecord(key, async () => record)
    await expect(ctx.uworkIdentity.restoreSession()).rejects.toMatchObject({ reason: 'PROTOCOL' })
  }
  await ctx.uworkIdentity.signOut()
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('rejects restoration of an organization outside the configured allowlist', async () => {
  const ctx = await harness()
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, state: 'session', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3', orgId: 'unapproved', token: token(), userId: 'user' } }))
  await expect(ctx.uworkIdentity.restoreSession()).rejects.toMatchObject({ reason: 'CONFIG' })
})
it('deduplicates verification, publishes restoring state and retains failed network recovery as a failure', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  let deliver!: (value: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve }))
  const first = ctx.uworkIdentity.restoreSession()
  const second = ctx.uworkIdentity.restoreSession()
  expect(first).toBe(second)
  await vi.waitFor(() =>{  expect(deliver).toBeTypeOf('function') })
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'restoring' })
  deliver(reply(auth()))
  expect((await first).status).toBe('authenticated')
  mock.mockResolvedValueOnce(reply(null, 500))
  await expect(ctx.uworkIdentity.restoreSession()).rejects.toMatchObject({ reason: 'HTTP' })
})
it('authorization flow commits through its own CAS and paces handoff polling', async () => {
  const mock = issuer()
  mock.mockImplementation(async input => targetPath(input).endsWith('/handoff/start') ? reply({ handoff_id: 'id', handoff_secret: 'synthetic', expires_at: new Date(Date.now() + 60000).toISOString() }, 201) : targetPath(input).endsWith('/handoff/claim') && mock.mock.calls.filter(([value]) => targetPath(value).endsWith('/handoff/claim')).length === 1 ? reply(null, 202) : reply(auth()))
  const ctx = await harness({ pollIntervalMs: 1 })
  const notices: unknown[] = []
  expect(await ctx.authorization.begin({ key, method: 'org', interaction: { notify: notice => notices.push(notice), prompt: async () => '' } })).toEqual({ status: 'authorized' })
  expect(notices).toHaveLength(1)
  expect((await ctx.uworkIdentity.getState()).status).toBe('authenticated')
})
it('authorization cancellation withdraws the polling timer and never writes a late grant', async () => {
  issuer()
  const ctx = await harness()
  const controller = new AbortController()
  let noticed!: () => void
  const ready = new Promise<void>((resolve) => { noticed = resolve })
  const operation = ctx.authorization.begin({ key, method: 'org', signal: controller.signal, interaction: { notify: () =>{  noticed() }, prompt: async () => '' } })
  await ready
  controller.abort()
  expect(await operation).toEqual({ status: 'cancelled' })
  await vi.waitFor(async () =>{  expect((await ctx.nativeAuthorization.getProvider()!.getState()).status).toBe('signed-out') })
})
it('native complete, disposal and registration lifetimes never leak credentials', async () => {
  issuer()
  const ctx = await harness()
  const provider = ctx.nativeAuthorization.getProvider()!
  const attempt = await provider.start('org', new AbortController().signal)
  expect((await provider.complete(attempt.id, callback(attempt), new AbortController().signal)).status).toBe('signed-in')
  const fiber = [...ctx.registry.get(EnterpriseIdentity)!.fibers][0]!
  await fiber.dispose()
  expect(ctx.nativeAuthorization.getProvider()).toBeUndefined()
  expect(ctx.authorization.list()).toEqual([])
})
it('an external revocation while login is in flight fails the generation check', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  let deliver!: (value: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve }))
  const operation = ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  await vi.waitFor(() =>{  expect(deliver).toBeTypeOf('function') })
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
  deliver(reply(auth()))
  await expect(operation).rejects.toMatchObject({ reason: 'STALE' })
  await ctx.uworkIdentity.cancelSignIn(attempt.id)
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('cancels upstream body work and validates all timestamp and URL representations', async () => {
  expect(() => parseConfiguration({ ...config, apiBaseUrl: 'not a url' })).toThrow()
  expect(() => parseIdentity({ ...auth(), token: 'e30.e2ludmFsaWR9.sig' }, 'org', Date.now())).toThrow()
  expect(parseHandoff({ handoff_id: 'id', handoff_secret: 'synthetic', expires_at: Date.now() + 60000 }, Date.now(), Date.now() + 1000).id).toBe('id')
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  vi.stubGlobal('fetch', vi.fn(async () => { throw controller.signal.reason }))
  await expect(request(parseConfiguration(config), '/test', {}, controller.signal)).rejects.toThrow('cancelled')
  const stream = new ReadableStream({ start(control) { control.enqueue(new TextEncoder().encode('x'.repeat(70000))) }, cancel() { throw new Error('synthetic cancellation error') } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
  await expect(request(parseConfiguration(config), '/test', {}, new AbortController().signal)).rejects.toMatchObject({ reason: 'PROTOCOL' })
})
it('serializes a native callback behind pending handoff polling', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  let deliver!: (response: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve }))
  const polling = ctx.uworkIdentity.pollSignIn(attempt.id)
  const duplicatePoll = ctx.uworkIdentity.pollSignIn(attempt.id)
  await vi.waitFor(() =>{  expect(deliver).toBeTypeOf('function') })
  const completion = ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  await Promise.resolve()
  deliver(reply(null, 202))
  await Promise.all([polling, duplicatePoll])
  expect((await completion).status).toBe('authenticated')
})
it('accepts a successful poll when its concurrent native callback is waiting', async () => {
  const mock = issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  let deliver!: (response: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { deliver = resolve }))
  const polling = ctx.uworkIdentity.pollSignIn(attempt.id)
  await vi.waitFor(() =>{  expect(deliver).toBeTypeOf('function') })
  const completion = ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  deliver(reply(auth()))
  expect((await polling).status).toBe('authenticated')
  expect((await completion).status).toBe('authenticated')
})
it('contains synchronous and asynchronous state observers after durable commits', async () => {
  issuer()
  const ctx = await harness()
  ctx.on('uwork-identity/changed', () => { throw new Error('synthetic observer failure') })
  const asynchronousObserver = (): unknown => Promise.reject(new Error('synthetic asynchronous observer failure'))
  ctx.on('uwork-identity/changed', asynchronousObserver)
  const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  await ctx.uworkIdentity.signOut()
  await vi.waitFor(() =>{  expect(warning).toHaveBeenCalledTimes(2) })
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('withdraws an active capability on unreadable persistent identity and reports failure', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  const changes: unknown[] = []
  ctx.on('uwork-identity/changed', (state) => { changes.push(state) })
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { malformed: true } }))
  await expect(ctx.uworkIdentity.getState()).rejects.toMatchObject({ reason: 'PROTOCOL' })
  expect(changes).toEqual([{ status: 'signed-out' }])
  await ctx.uworkIdentity.signOut()
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('observes cross-process cancellation during Host work and respects caller cancellation', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  const caller = new AbortController()
  expect(await ctx.uworkIdentity.withSession(async () => 1, caller.signal)).toBe(1)
  caller.abort(new Error('caller cancelled'))
  await expect(ctx.uworkIdentity.withSession(async () => 1, caller.signal)).rejects.toThrow('caller cancelled')
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const operation = ctx.uworkIdentity.withSession(async (session) => {
    entered()
    await new Promise<void>((resolve) =>{  session.signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
  })
  await ready
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
  await expect(operation).rejects.toMatchObject({ reason: 'STALE' })
})
it('latest local intent wins when start and logout overlap before store admission', async () => {
  issuer()
  const ctx = await harness()
  const [logout, start] = await Promise.allSettled([ctx.uworkIdentity.signOut(), ctx.uworkIdentity.startSignIn('org')])
  expect(logout.status).toBe('fulfilled')
  expect(start.status).toBe('fulfilled')
  const pair = await Promise.allSettled([ctx.uworkIdentity.startSignIn('org'), ctx.uworkIdentity.startSignIn('org')])
  expect(pair[0]).toMatchObject({ status: 'rejected', reason: { reason: 'STALE' } })
  expect(pair[1].status).toBe('fulfilled')
})
it('a superseded handoff failure cannot cancel its replacement', async () => {
  const mock = issuer()
  const ctx = await harness()
  let reject!: (error: Error) => void
  mock.mockImplementationOnce(() => new Promise<Response>((_resolve, fail) => { reject = fail }))
  const first = ctx.uworkIdentity.startSignIn('org')
  const firstResult = first.catch((error: unknown) => error)
  await vi.waitFor(() =>{  expect(reject).toBeTypeOf('function') })
  const replacement = await ctx.uworkIdentity.startSignIn('org')
  reject(new Error('synthetic network failure'))
  await firstResult
  expect((await ctx.nativeAuthorization.getProvider()!.getState()).status).toBe('pending')
  await ctx.uworkIdentity.cancelSignIn(replacement.id)
})
it('checks generation under the credential lock, including the verification snapshot race', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  const modify = ctx.credentials.modifyRecord.bind(ctx.credentials)
  vi.spyOn(ctx.credentials, 'modifyRecord').mockImplementationOnce(async (recordKey, mutate) => {
    await modify(recordKey, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
    return modify(recordKey, mutate)
  })
  await expect(ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: 'STALE' })
  await ctx.uworkIdentity.cancelSignIn(attempt.id)
  const next = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(next.id, callback(next))
  vi.spyOn(ctx.credentials, 'modifyRecord').mockImplementationOnce(async (recordKey, mutate) => {
    await modify(recordKey, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
    return modify(recordKey, mutate)
  })
  await expect(ctx.uworkIdentity.restoreSession(new AbortController().signal)).rejects.toMatchObject({ reason: 'STALE' })
})
it('checks post-commit state and session expiry before publishing authentication', async () => {
  issuer()
  const ctx = await harness()
  for (const expire of [false, true]) {
    const attempt = await ctx.uworkIdentity.startSignIn('org')
    const read = ctx.credentials.readRecord.bind(ctx.credentials)
    let reads = 0
    const spy = vi.spyOn(ctx.credentials, 'readRecord').mockImplementation(async (recordKey) => {
      reads++
      if (reads === 3) {
        if (expire) { const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 86400000) }
        else await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { version: 1, state: 'empty', generation: '38ee29a6-768c-42ab-8ff6-b069429d7fb3' } }))
      }
      return read(recordKey)
    })
    await expect(ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: expire ? 'EXPIRED' : 'STALE' })
    spy.mockRestore()
    vi.spyOn(Date, 'now').mockRestore()
  }
})
it('reentrant logout at the authentication notification cannot resurrect the attempt', async () => {
  issuer()
  const ctx = await harness()
  let logout: Promise<void> | undefined
  ctx.on('uwork-identity/changed', (state) => { if (state.status === 'authenticated') logout = ctx.uworkIdentity.signOut() })
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  expect(await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).toEqual({ status: 'signed-out' })
  await logout
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('refresh classifies forbidden and server failures without fallback', async () => {
  const mock = issuer()
  const ctx = await harness()
  for (const status of [403, 500]) {
    const attempt = await ctx.uworkIdentity.startSignIn('org')
    mock.mockResolvedValueOnce(reply(auth())).mockResolvedValueOnce(new Response(null, { status }))
    await expect(ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))).rejects.toMatchObject({ reason: status === 403 ? 'UNAUTHORIZED' : 'HTTP' })
  }
})
it('background observation contains store failures after cancelling the affected session', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  const work = ctx.uworkIdentity.withSession(async (session) => {
    await new Promise<void>((resolve) =>{  session.signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
  })
  await Promise.resolve()
  await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { invalid: true } }))
  await expect(work).rejects.toMatchObject({ reason: 'STALE' })
  await ctx.uworkIdentity.signOut()
})
it('an obsolete observation failure does not invalidate a newer local intent', async () => {
  issuer()
  const ctx = await harness()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  let reject!: (error: Error) => void
  const read = vi.spyOn(ctx.credentials, 'readRecord').mockImplementationOnce(() => new Promise<CredentialRecord | undefined>((_resolve, fail) => { reject = fail }))
  const observation = ctx.uworkIdentity.getState().catch((error: unknown) => error)
  await vi.waitFor(() =>{  expect(reject).toBeTypeOf('function') })
  await ctx.uworkIdentity.signOut()
  reject(new Error('synthetic read failure'))
  expect(await observation).toBeInstanceOf(Error)
  read.mockRestore()
  expect(await ctx.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
})
it('streams current safe identity and logout changes, with subscriber and plugin cancellation cleanup', async () => {
  issuer()
  const ctx = await harness()
  const caller = new AbortController()
  const states = ctx.uworkIdentity.watchState(caller.signal)[Symbol.asyncIterator]()
  expect(await states.next()).toEqual({ value: { status: 'signed-out' }, done: false })
  const next = states.next()
  const attempt = await ctx.uworkIdentity.startSignIn('org')
  expect(await next).toEqual({ value: { status: 'signed-out' }, done: false })
  await ctx.uworkIdentity.completeSignIn(attempt.id, callback(attempt))
  expect(await states.next()).toMatchObject({ done: false, value: { status: 'authenticated' } })
  const logout = states.next()
  await ctx.uworkIdentity.signOut()
  expect(await logout).toEqual({ value: { status: 'signed-out' }, done: false })
  const closed = states.next()
  caller.abort()
  expect(await closed).toEqual({ value: undefined, done: true })
  const stopped = new AbortController()
  stopped.abort()
  expect(await ctx.uworkIdentity.watchState(stopped.signal)[Symbol.asyncIterator]().next()).toEqual({ value: undefined, done: true })
  const another = ctx.uworkIdentity.watchState(new AbortController().signal)[Symbol.asyncIterator]()
  await another.next()
  const waiting = another.next()
  await [...ctx.registry.get(EnterpriseIdentity)!.fibers][0]!.dispose()
  expect(await waiting).toEqual({ value: undefined, done: true })
})
it('cancellation during the initial stream read publishes no stale state', async () => {
  issuer()
  const ctx = await harness()
  const controller = new AbortController()
  const read = ctx.credentials.readRecord.bind(ctx.credentials)
  vi.spyOn(ctx.credentials, 'readRecord').mockImplementationOnce(async (recordKey) => { controller.abort(); return read(recordKey) })
  const states = ctx.uworkIdentity.watchState(controller.signal)[Symbol.asyncIterator]()
  expect(await states.next()).toEqual({ value: undefined, done: true })
})
it('rejects new work through a retained service after plugin disposal', async () => {
  const ctx = await harness()
  const service = ctx.uworkIdentity
  await [...ctx.registry.get(EnterpriseIdentity)!.fibers][0]!.dispose()
  await expect(service.getState()).rejects.toMatchObject({ reason: 'DISPOSED' })
  await expect(service.signOut()).rejects.toMatchObject({ reason: 'DISPOSED' })
  await expect(service.restoreSession()).rejects.toMatchObject({ reason: 'DISPOSED' })
  await expect(service.withSession(async () => 1)).rejects.toMatchObject({ reason: 'DISPOSED' })
  await expect(service.startSignIn('org')).rejects.toMatchObject({ reason: 'DISPOSED' })
})
it('projects Host-verified native expiry and clears it on retry, explicit cancellation and logout', async () => {
  issuer()
  const ctx = await harness()
  const provider = ctx.nativeAuthorization.getProvider()!
  const signal = new AbortController().signal
  const initialTime = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
  async function expire() {
    const attempt = await provider.start('org', signal)
    clock.mockReturnValue(attempt.expiresAt + 1)
    await expect(provider.poll(attempt.id, signal)).rejects.toMatchObject({ reason: 'EXPIRED' })
    expect(await provider.getState()).toMatchObject({ status: 'signed-out', error: 'expired', selectedChoiceId: 'org' })
    expect(await provider.getState()).not.toHaveProperty('attempt')
    return attempt
  }
  const expired = await expire()
  await provider.cancel(brandString<NativeAuthorizationAttemptId>(expired.id + '-unrelated'))
  expect(await provider.getState()).toHaveProperty('error', 'expired')
  const retry = await provider.start('org', signal)
  expect(await provider.getState()).toMatchObject({ status: 'pending' })
  expect(await provider.getState()).not.toHaveProperty('error')
  await provider.cancel(retry.id)
  const cancelled = await expire()
  expect(await provider.cancel(cancelled.id)).not.toHaveProperty('error')
  await expire()
  await ctx.uworkIdentity.signOut()
  expect(await provider.getState()).not.toHaveProperty('error')
})
