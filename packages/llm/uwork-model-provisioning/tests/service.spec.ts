import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-uwork-enterprise'
import Provisioning from '../src/index.ts'
import type { ProvisionInput } from '../src/transaction.ts'

const input = (): ProvisionInput => ({ binding: { orgId: 'org', userId: 'user', generation: 'gen' },
  provider: 'uwork-gen', credentialRef: 'UWORK_GEN', endpoint: 'https://gateway.example/v1', apiKey: 'fixture-key',
  authorizedModels: ['m'], capabilities: [{ id: 'm', contextWindow: 8192, maxTokens: 1024, input: ['text', 'image'] }],
  preferredModels: ['m'], signal: new AbortController().signal })
afterEach(() => vi.unstubAllGlobals())
async function fixture(options: {
  gateway?: boolean
  initial?: CredentialRecord
  preferredModels?: string[]
  skipRecovery?: boolean
  journalUnavailable?: boolean
  journalRead?: Promise<undefined>
} = {}) {
  const records = new Map<string, CredentialRecord>()
  const journalKey = 'uwork-model-provisioning/route'
  if (options.initial) records.set(journalKey, options.initial)
  let journalUnavailable = options.journalUnavailable ?? false
  let revision = 0
  let value: { providers?: object } = {}
  let available = true
  let conflict = false
  let conflictRecord: CredentialRecord | undefined
  let defaultSelection = { provider: '', model: '' }
  const secrets = new Map<string, string>()
  const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('credentials', {
    readRecord: async (key: string) => {
      await options.journalRead
      if (key === journalKey && journalUnavailable) throw new Error('Credential backend unavailable')
      return records.get(key)
    },
    modifyRecord: async (key: string, change: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      if (conflict) { records.set(key, conflictRecord ?? { kind: 'grant', payload: { version: 1, phase: 'staged', route: { provider: 'uwork-other', credentialRef: 'UWORK_OTHER', binding: { orgId: 'org', userId: 'user', generation: 'other' }, profile: { apiKeyEnv: 'UWORK_OTHER', api: 'openai-completions', baseURL: 'https://gateway.example/v1', models: [] } } } }); conflict = false }
      const next = await change(records.get(key)); if (next) records.set(key, next); return next
    },
    describe: async (ref: string) => ({ configured: secrets.has(ref), writable: true }),
    set: async (ref: string, secret: string) => { secrets.set(ref, secret) }, unset: async (ref: string) => { secrets.delete(ref) },
  } as never)
  ctx.provide('settings', { describe: () => available ? [{ ns: 'llm-pi-ai', revision, value, user: value }] : [],
    mutate: async (_ns: string, ops: { op: string; path: readonly [string, string]; value?: object }[]) => {
      const providers: Record<string, unknown> = { ...value.providers }
      for (const op of ops) {
        if (op.op === 'unset') Reflect.deleteProperty(providers, op.path[1])
        else providers[op.path[1]] = structuredClone(op.value)
      }
      value = { providers }; revision++
    },
  } as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => defaultSelection, saveSelection: async (next: typeof defaultSelection) => { defaultSelection = next } } as never)
  await ctx.plugin(Provisioning, options.gateway ? { gatewayApiBaseUrl: 'https://control.example', allowedModelEndpointOrigins: ['https://models.example'], preferredModels: options.preferredModels ?? ['m'] } : {})
  if (!options.skipRecovery) await ctx.uworkModelProvisioning.recover()
  return { ctx, secrets, records,
    repairJournal: () => { journalUnavailable = false },
    setDefault: (next: typeof defaultSelection) => { defaultSelection = next },
    setRecord: (next: CredentialRecord) => { records.set(journalKey, next) },
    setAvailable: (next: boolean) => { available = next },
    conflict: (next?: CredentialRecord) => { conflict = true; conflictRecord = next },
    get record() { return records.get(journalKey) }, get value() { return value } }
}
it('composes request lifecycle listeners and keeps secret values outside settings', async () => {
  const f = await fixture(); const controller = new AbortController()
  const inherited = new AbortController()
  f.ctx.on('llm-pi-ai/request-signal', (_request, next) => { next(); return inherited.signal })
  await f.ctx.uworkModelProvisioning.provision({ ...input(), signal: controller.signal })
  const request = { provider: 'uwork-gen', model: 'm', baseURL: 'https://gateway.example/v1' }
  const managed = f.ctx.waterfall('llm-pi-ai/request-signal', request, () => undefined)!
  expect(managed.aborted).toBe(false); controller.abort(); expect(managed.aborted).toBe(true)
  expect(f.ctx.waterfall('llm-pi-ai/request-signal', { ...request, provider: 'personal' }, () => undefined)).toBe(inherited.signal)
  f.ctx.uworkModelProvisioning.revoke()
  expect(() => f.ctx.waterfall('llm-pi-ai/request-signal', request, () => undefined)).toThrow()
  await f.ctx.uworkModelProvisioning.recover()
  expect(f.secrets.size).toBe(0)
})
it('returns a standalone route signal without requiring another listener', async () => {
  const f = await fixture(); await f.ctx.uworkModelProvisioning.provision(input())
  expect(f.ctx.waterfall('llm-pi-ai/request-signal', { provider: 'uwork-gen', model: 'm', baseURL: 'https://gateway.example/v1' }, () => undefined)).toBeInstanceOf(AbortSignal)
  expect(f.ctx.waterfall('llm-pi-ai/request-signal', { provider: 'personal', model: 'm', baseURL: 'https://gateway.example/v1' }, () => undefined)).toBeUndefined()
  expect(f.ctx.waterfall('llm-pi-ai/discovery-signal', {}, () => undefined)).toBeUndefined()
})
it.each([null, {}, { version: 2 }, { version: 1, phase: 'other', route: {} },
  { version: 1, phase: 'staged', route: {} },
  { version: 1, phase: 'staged', route: { provider: 'uwork-gen', credentialRef: 'UWORK_GEN', binding: { orgId: 'org', userId: 'user', generation: 'gen' }, profile: {} } },
])('rejects malformed durable journal %j', async (payload) => {
  const f = await fixture(); f.setRecord({ kind: 'grant', payload })
  if (payload === null) { await f.ctx.uworkModelProvisioning.recover(); return }
  await expect(f.ctx.uworkModelProvisioning.recover()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
})
it('rejects a foreign record kind without interpreting it', async () => {
  const f = await fixture(); f.setRecord({ kind: 'api-key', key: 'foreign' })
  await expect(f.ctx.uworkModelProvisioning.recover()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
})
it('detects a cross-process journal race before writing a secret', async () => {
  const f = await fixture(); f.conflict()
  await expect(f.ctx.uworkModelProvisioning.provision(input())).rejects.toMatchObject({ code: 'ROUTE_CONFLICT' })
  expect(f.secrets.size).toBe(0)
})
it('fails closed when the native settings namespace is unavailable', async () => {
  const f = await fixture(); f.setAvailable(false)
  await expect(f.ctx.uworkModelProvisioning.provision(input())).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
})
it('contains startup reconciliation rejection and permits an explicit repair retry', async () => {
  await expect(fixture({ initial: { kind: 'api-key', key: 'foreign' } })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
})

function identity(ctx: Context, state: object = { status: 'authenticated' }) {
  const getState = vi.fn(async () => state)
  ctx.provide('uworkIdentity', { getState,
    withSession: async (run: (session: object) => Promise<unknown>) => run({ orgId: 'org', userId: 'user', generation: 'gen', token: 'private-token', signal: new AbortController().signal }),
  } as never)
  return getState
}
function gateway(options: { noKeys?: boolean; unknown?: boolean; fail?: boolean } = {}) {
  const calls = vi.fn(async (target: URL, init: RequestInit) => {
    const path = target.pathname
    if (options.fail) return Response.json({}, { status: 503 })
    if (path === '/api/auth/orgs') return Response.json({ llm_base_url: 'https://models.example/v1' })
    if (path === '/api/usage/models') return Response.json({ models: ['m'], unrestricted: false, hasSubscription: true })
    if (path === '/api/keys') return Response.json({ keys: options.noKeys ? [] : [{ id: 'one', alias: 'existing', masked_key: '***', status: 'active' }] })
    if (path === '/api/keys/one/reveal') return Response.json({ key: 'private-key' })
    if (path === '/api/keys/generate') return options.unknown ? Response.json({}, { status: 503 }) : Response.json({ id: 'two', key: 'created-key', masked_key: '***', status: 'active' })
    expect(path).toBe('/v1/models')
    expect(new Headers(init.headers).get('authorization')).toMatch(/^Bearer (private|created)-key$/)
    return Response.json({ data: [{ id: 'm', context_window: 8192, max_output_tokens: 1024, input_modalities: ['text'], supports_tools: true, supports_reasoning: false }] })
  })
  vi.stubGlobal('fetch', calls)
  return calls
}
it('returns safe idle/configuration failure states without exposing Host provisioning input', async () => {
  const f = await fixture(); const signal = new AbortController().signal
  expect(await f.ctx.uworkModelProvisioning.getState(signal)).toEqual({ status: 'idle' })
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toEqual({ status: 'error', reason: 'storage' })
})
it('refreshes the authenticated account through gateway and native routes from the safe Remote facade', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); gateway()
  const signal = new AbortController().signal
  const state = await f.ctx.uworkModelProvisioning.getState(signal)
  expect(state).toMatchObject({ status: 'ready', modelIds: ['m'] })
  expect(JSON.stringify(state)).not.toContain('private')
  expect((await f.ctx.uworkModelProvisioning.getState(signal)).status).toBe('ready')
  expect((await f.ctx.uworkModelProvisioning.syncCurrent()).status).toBe('ready')
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready' })
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, signal)).toMatchObject({ status: 'ready' })
  expect(f.secrets.size).toBe(1)
})
it('syncs after login, seals routes after logout and observes cross-process identity absence', async () => {
  const f = await fixture({ gateway: true }); const getState = identity(f.ctx); gateway()
  await f.ctx.fiber.await()
  f.ctx.emit('uwork-identity/changed', { status: 'authenticated', orgId: 'org', userId: 'user', name: 'User', expiresAt: Date.now() + 10000, generation: 'gen' } as never)
  await vi.waitFor(async () => { expect((await f.ctx.uworkModelProvisioning.getState(new AbortController().signal)).status).toBe('ready') })
  f.ctx.emit('uwork-identity/changed', { status: 'signed-out' })
  getState.mockResolvedValue({ status: 'signed-out' })
  expect(await f.ctx.uworkModelProvisioning.getState(new AbortController().signal)).toEqual({ status: 'signed-out' })
})
it('classifies identity absence and backend failures without serializing private upstream errors', async () => {
  const f = await fixture({ gateway: true }); const signal = new AbortController().signal
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toEqual({ status: 'error', reason: 'storage' })
  const getState = identity(f.ctx); gateway({ fail: true })
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toEqual({ status: 'error', reason: 'gateway' })
  getState.mockRejectedValue(new Error('private failure'))
  expect(await f.ctx.uworkModelProvisioning.getState(signal)).toEqual({ status: 'error', reason: 'identity' })
  const cancelled = new AbortController(); cancelled.abort()
  expect(await f.ctx.uworkModelProvisioning.refresh(cancelled.signal)).toEqual({ status: 'error', reason: 'unavailable' })
})
it('persists unknown key outcomes across refreshes without repeating the user POST', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); const calls = gateway({ noKeys: true, unknown: true })
  const signal = new AbortController().signal
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(calls.mock.calls.filter(([url]) => url.pathname === '/api/keys/generate')).toHaveLength(1)
})
it.each([{ kind: 'api-key', key: 'foreign' }, { kind: 'grant', payload: {} }])('rejects malformed durable key intents %j', async (record) => {
  const f = await fixture({ gateway: true }); identity(f.ctx); gateway()
  const digest = createHash('sha256').update(JSON.stringify(['org', 'user'])).digest('hex')
  f.records.set(`uwork-model-provisioning/key-intent-${digest}`, record as CredentialRecord)
  expect(await f.ctx.uworkModelProvisioning.refresh(new AbortController().signal)).toEqual({ status: 'error', reason: 'storage' })
})
it('commits successful explicit key creation and accepts the owner tombstone for the next intent', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); gateway({ noKeys: true })
  const signal = new AbortController().signal
  expect((await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, signal)).status).toBe('ready')
  expect((await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, signal)).status).toBe('ready')
})
it('rejects a key intent race under the credential record lock before posting', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); const calls = gateway({ noKeys: true })
  f.conflict()
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, new AbortController().signal)).toEqual({ status: 'error', reason: 'storage' })
  expect(calls.mock.calls.some(([url]) => url.pathname === '/api/keys/generate')).toBe(false)
})
it('prompts for a missing default while preserving an already chosen personal default', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); gateway()
  const signal = new AbortController().signal
  f.setDefault({ provider: 'personal', model: '' })
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready', needsModelSelection: true })
  f.setDefault({ provider: 'personal', model: 'mine' })
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready', needsModelSelection: false })
})
it('does not let a superseded failed refresh overwrite a newer observation', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); gateway()
  const signal = new AbortController().signal
  const first = f.ctx.uworkModelProvisioning.refresh(signal)
  const second = f.ctx.uworkModelProvisioning.refresh(signal)
  await first
  expect(await second).toMatchObject({ status: 'ready' })
})
it('does not publish a successful stale callback after a newer refresh starts', async () => {
  const f = await fixture({ gateway: true }); gateway()
  const prepared = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  let calls = 0
  f.ctx.provide('uworkIdentity', {
    getState: async () => ({ status: 'authenticated' }),
    withSession: async (run: (session: object) => Promise<unknown>) => {
      const result = await run({ orgId: 'org', userId: 'user', generation: 'gen', token: 'private-token', signal: new AbortController().signal })
      if (++calls === 1) { prepared.resolve(undefined); await release.promise }
      return result
    },
  } as never)
  const signal = new AbortController().signal
  const first = f.ctx.uworkModelProvisioning.refresh(signal)
  await prepared.promise
  const second = f.ctx.uworkModelProvisioning.refresh(signal)
  release.resolve(undefined)
  expect((await first).status).toBe('syncing')
  expect((await second).status).toBe('ready')
})
it('does not overwrite a newer cross-process key intent when an old POST settles', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); const calls = gateway({ noKeys: true })
  const original = calls.getMockImplementation()!
  const digest = createHash('sha256').update(JSON.stringify(['org', 'user'])).digest('hex')
  const recordKey = `uwork-model-provisioning/key-intent-${digest}`
  const later = { version: 1, orgId: 'org', userId: 'user', alias: 'UWork-11111111-1111-1111-1111-111111111111', outcome: 'pending' }
  calls.mockImplementation(async (url, init) => {
    const reply = await original(url, init)
    if (url.pathname === '/api/keys/generate') f.records.set(recordKey, { kind: 'grant', payload: later })
    return reply
  })
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, new AbortController().signal)).toEqual({ status: 'error', reason: 'storage' })
  expect(f.records.get(recordKey)).toEqual({ kind: 'grant', payload: later })
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'user', generation: 'gen' }, new AbortController().signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(calls.mock.calls.filter(([url]) => url.pathname === '/api/keys/generate')).toHaveLength(1)
})
it('rejects an endpoint edit and cancels already admitted native requests on a settings change', async () => {
  const f = await fixture(); await f.ctx.uworkModelProvisioning.provision(input())
  const request = { provider: 'uwork-gen', model: 'm', baseURL: 'https://gateway.example/v1' }
  const signal = f.ctx.waterfall('llm-pi-ai/request-signal', request, () => undefined)!
  f.ctx.emit('settings/document-updated', 'other' as never, 1)
  f.ctx.emit('settings/document-updated', 'llm-pi-ai' as never, 1)
  expect(signal.aborted).toBe(false)
  const providers = f.value.providers as Record<string, { displayName?: string }>
  const managed = providers['uwork-gen']
  if (managed === undefined) throw new Error('Expected managed provider fixture')
  managed.displayName = 'Edited'
  f.ctx.emit('settings/document-updated', 'llm-pi-ai' as never, 2)
  expect(signal.aborted).toBe(true)
  expect(() => f.ctx.waterfall('llm-pi-ai/request-signal', request, () => undefined)).toThrow()
})
it('never overwrites a foreign record kind that races the journal reservation', async () => {
  const f = await fixture(); const foreign: CredentialRecord = { kind: 'api-key', key: 'foreign' }; f.conflict(foreign)
  await expect(f.ctx.uworkModelProvisioning.provision(input())).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' })
  expect(f.record).toEqual(foreign)
})
it('prompts for initial and revoked enterprise defaults when the release declares no preference', async () => {
  const f = await fixture({ gateway: true, preferredModels: [] }); identity(f.ctx); gateway()
  const signal = new AbortController().signal
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready', needsModelSelection: true })
  f.setDefault({ provider: 'uwork-expired', model: 'revoked' })
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready', needsModelSelection: true })
})
it('refuses a confirmation for a different account before gateway admission and returns a safe identity failure', async () => {
  const f = await fixture({ gateway: true }); identity(f.ctx); const calls = gateway({ noKeys: true })
  expect(await f.ctx.uworkModelProvisioning.createManagedKey({ orgId: 'org', userId: 'previous-user', generation: 'gen' },
    new AbortController().signal)).toEqual({ status: 'error', reason: 'identity' })
  expect(calls).not.toHaveBeenCalled(); expect(f.records.size).toBe(0)
})
it('retries a failed startup recovery once from the safe refresh action after the credential backend is repaired', async () => {
  const prior: CredentialRecord = { kind: 'grant', payload: { version: 1, phase: 'staged', route: {
    binding: { orgId: 'org', userId: 'user', generation: 'old' }, provider: 'uwork-old', credentialRef: 'UWORK_OLD',
    profile: { api: 'openai-completions', baseURL: 'https://gateway.example/v1', apiKeyEnv: 'UWORK_OLD', models: [] },
  } } }
  const f = await fixture({ gateway: true, initial: prior, skipRecovery: true, journalUnavailable: true })
  identity(f.ctx); const calls = gateway()
  const signal = new AbortController().signal
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toEqual({ status: 'error', reason: 'unavailable' })
  expect(f.record).toEqual(prior); expect(calls).not.toHaveBeenCalled()
  f.repairJournal()
  expect(await f.ctx.uworkModelProvisioning.refresh(signal)).toMatchObject({ status: 'ready' })
  expect(f.record).not.toEqual(prior)
})
it('waits for owned startup reconciliation to settle during disposal', async () => {
  const read = Promise.withResolvers<undefined>()
  const f = await fixture({ skipRecovery: true, journalRead: read.promise })
  let settled = false
  const closing = f.ctx.fiber.dispose().then(() => { settled = true })
  await Promise.resolve(); await Promise.resolve()
  try { expect(settled).toBe(false) } finally { read.resolve(undefined) }
  await closing
  expect(settled).toBe(true)
})
