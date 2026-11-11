import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { GatewayRequestError } from '@deepseek-ai/dsh-uwork-gateway'
import type { GatewayKey, GatewayKeyId, GatewayModel } from '@deepseek-ai/dsh-uwork-gateway/types'
import type { IdentitySession, OrganizationId, IdentityGeneration } from '@deepseek-ai/dsh-uwork-enterprise/types'
import Provisioning from '../src/index.ts'
import type { ModelCatalogEntry } from '../src/types.ts'
import { ModelSynchronizer, nativeCapabilities, type KeyIntent, type SyncPorts } from '../src/synchronizer.ts'

const model: GatewayModel = { id: 'allowed', contextWindow: 8192, maxOutputTokens: 1024, inputModalities: ['text'], supportsTools: true, supportsReasoning: false }
const key: GatewayKey = { id: brandString<GatewayKeyId>('key-1'), alias: 'existing', maskedKey: '***', status: 'active' }
function fixture() {
  let intent: KeyIntent | undefined
  let keys: readonly GatewayKey[] = [key]
  const abort = new AbortController()
  const session: IdentitySession = { orgId: brandString<OrganizationId>('org'), userId: 'user',
    generation: brandString<IdentityGeneration>('generation'), token: 'private-token', signal: abort.signal }
  const client = { readPublicEndpoint: vi.fn(async () => 'https://gateway.example/v1'),
    readPlanModels: vi.fn(async () => ({ models: ['allowed'], unrestricted: false, hasSubscription: true })),
    listKeys: vi.fn(async () => keys), revealKey: vi.fn(async () => 'private-key'),
    generateKey: vi.fn(async (alias: string) => ({ key: { ...key, alias }, apiKey: 'generated-key' })),
    listEndpointModels: vi.fn(async () => [model]),
  }
  const provision = vi.fn<SyncPorts['provision']>(async input => input.provider)
  const ports: SyncPorts = { withSession: run => run(session), client: () => client, readIntent: async () => intent,
    writeIntent: async (_binding, next) => { intent = next }, provision, revoke: vi.fn(), needsModelSelection: () => false }
  return { abort, client, ports, provision, setKeys: (next: readonly GatewayKey[]) => { keys = next },
    get intent() { return intent }, setIntent: (next: KeyIntent) => { intent = next },
    sync: new ModelSynchronizer(ports, ['allowed']) }
}
it('reuses an existing enterprise key and provisions a fresh generation-owned native route', async () => {
  const f = fixture(); const result = await f.sync.sync(false, new AbortController().signal)
  expect(result.status).toBe('ready'); expect(f.client.generateKey).not.toHaveBeenCalled()
  const provisioned = f.provision.mock.calls[0]?.[0]
  if (provisioned === undefined) throw new Error('Expected committed provisioning input')
  expect(provisioned.apiKey).toBe('private-key'); expect(provisioned.authorizedModels).toEqual(['allowed'])
  expect(provisioned.provider).toMatch(/^uwork-/); expect(provisioned.credentialRef).toMatch(/^UWORK_/)
  expect(provisioned.binding).toEqual({ orgId: 'org', userId: 'user', generation: 'generation' })
  expect(JSON.stringify(result)).not.toContain('private')
})
it('requires explicit key creation when there is no active enterprise key', async () => {
  const f = fixture(); f.setKeys([{ ...key, status: 'disabled' }])
  expect(await f.sync.sync(false, new AbortController().signal)).toEqual({ status: 'key-required' })
  expect(f.client.generateKey).not.toHaveBeenCalled()
})
it('persists an intent before the single explicit POST and clears it after a known success', async () => {
  const f = fixture(); f.setKeys([])
  f.client.generateKey.mockImplementation(async (alias) => {
    expect(f.intent).toMatchObject({ orgId: 'org', userId: 'user', alias, outcome: 'pending' })
    return { key: { ...key, alias }, apiKey: 'generated-key' }
  })
  expect((await f.sync.sync(true, new AbortController().signal)).status).toBe('ready')
  expect(f.intent).toBeUndefined(); expect(f.client.generateKey).toHaveBeenCalledOnce()
})
it('never repeats a create after an unknown outcome, including after process reconstruction', async () => {
  const f = fixture(); f.setKeys([])
  f.client.generateKey.mockRejectedValue(new GatewayRequestError('network', undefined, 'unknown'))
  expect(await f.sync.sync(true, new AbortController().signal)).toEqual({ status: 'key-outcome-unknown' })
  const durable = f.intent!; expect(durable.outcome).toBe('unknown')
  const restarted = new ModelSynchronizer(f.ports, ['allowed'])
  expect(await restarted.sync(true, new AbortController().signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(f.client.generateKey).toHaveBeenCalledOnce()
  f.setKeys([{ ...key, alias: durable.alias }])
  expect((await restarted.sync(true, new AbortController().signal)).status).toBe('ready')
  expect(f.client.generateKey).toHaveBeenCalledOnce(); expect(f.intent).toBeUndefined()
})
it('retains an unknown intent for unexpected post-creation failures', async () => {
  const f = fixture(); f.setKeys([]); f.client.generateKey.mockRejectedValue(new Error('connection lost'))
  expect(await f.sync.sync(true, new AbortController().signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(f.intent?.outcome).toBe('unknown')
})
it('allows another explicit attempt only after a known unchanged failure', async () => {
  const f = fixture(); f.setKeys([])
  f.client.generateKey.mockRejectedValueOnce(new GatewayRequestError('forbidden', 403, 'unchanged'))
  await expect(f.sync.sync(true, new AbortController().signal)).rejects.toMatchObject({ kind: 'forbidden' })
  expect(f.intent).toBeUndefined()
  expect((await f.sync.sync(true, new AbortController().signal)).status).toBe('ready')
})
it('keeps pending crash intents blocked and does not use a different active key to hide the outcome', async () => {
  const f = fixture(); f.setIntent({ version: 1, orgId: 'org', userId: 'user', alias: 'UWork-prior', outcome: 'pending' })
  expect(await f.sync.sync(true, new AbortController().signal)).toEqual({ status: 'key-outcome-unknown' })
  expect(f.client.revealKey).not.toHaveBeenCalled()
})
it('does not activate unknown or unauthorized endpoint models', async () => {
  const f = fixture(); f.client.listEndpointModels.mockResolvedValue([{ id: 'allowed' }, { ...model, id: 'unauthorized' }])
  expect(await f.sync.sync(false, new AbortController().signal)).toEqual({ status: 'capabilities-required' })
  expect(f.provision).not.toHaveBeenCalled()
})
it('admits only configured and authorized legacy text routes without replacing explicit capability refusals', () => {
  const legacy = { modelIds: ['allowed', 'not-authorized', 'tool-less', 'image-only'], contextWindow: 8192, maxOutputTokens: 1024 }
  expect(nativeCapabilities([{ id: 'allowed' }, { id: 'unconfigured' }, { id: 'not-authorized' },
    { id: 'tool-less', supportsTools: false }, { id: 'image-only', inputModalities: ['image'] }],
  ['allowed', 'unconfigured', 'tool-less', 'image-only'], legacy)).toEqual([
    { id: 'allowed', contextWindow: 8192, maxTokens: 1024, input: ['text'], reasoningEfforts: false },
  ])
})
it('aborts before any request if the owning identity is revoked', async () => {
  const f = fixture(); f.abort.abort()
  await expect(f.sync.sync(false, new AbortController().signal)).rejects.toThrow()
  expect(f.client.listKeys).not.toHaveBeenCalled()
})
it('compensates a known cancellation before the create POST without leaving an unknown outcome', async () => {
  const f = fixture(); f.setKeys([])
  const write = f.ports.writeIntent
  f.ports.writeIntent = async (binding, next, expected) => {
    await write(binding, next, expected)
    if (next?.outcome === 'pending') f.abort.abort()
  }
  await expect(f.sync.sync(true, new AbortController().signal)).rejects.toThrow()
  expect(f.client.generateKey).not.toHaveBeenCalled(); expect(f.intent).toBeUndefined()
})
it('invalidates an older queued synchronization without making requests', async () => {
  const f = fixture()
  const older = f.sync.sync(false, new AbortController().signal)
  const newer = f.sync.sync(false, new AbortController().signal)
  await expect(older).rejects.toThrow('superseded')
  expect((await newer).status).toBe('ready')
  expect(f.client.listKeys).toHaveBeenCalledOnce()
})
it('maps only verified native image/reasoning facts and canonical effort names', () => {
  expect(nativeCapabilities([{ ...model, inputModalities: ['text', 'image'], supportsVision: true, supportsReasoning: true,
    reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'enabled', 'disabled'] }], ['allowed']))
    .toEqual([{ id: 'allowed', contextWindow: 8192, maxTokens: 1024, input: ['text', 'image'],
      reasoningEfforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }])
  expect(nativeCapabilities([{ ...model, supportsReasoning: true }], ['allowed'])).toEqual([])
  expect(nativeCapabilities([{ ...model, supportsReasoning: true, reasoningLevels: ['enabled'] }], ['allowed'])).toEqual([])
})
it('treats only explicit unrestricted authorization as permission for the verified endpoint directory', async () => {
  const f = fixture(); f.client.readPlanModels.mockResolvedValue({ models: [], unrestricted: true, hasSubscription: true })
  expect((await f.sync.sync(false, new AbortController().signal)).status).toBe('ready')
  expect(f.provision).toHaveBeenCalledWith(expect.objectContaining({ authorizedModels: ['allowed'] }))
  f.client.readPlanModels.mockResolvedValue({ models: [], unrestricted: false, hasSubscription: true })
  expect((await f.sync.sync(false, new AbortController().signal)).status).toBe('capabilities-required')
})
it.each(['orgId', 'userId', 'generation'])('refuses an obsolete %s confirmation before any gateway request', async (field) => {
  const f = fixture(); f.setKeys([])
  const binding = { orgId: 'org', userId: 'user', generation: 'generation', [field]: 'other' }
  await expect(f.sync.sync(true, new AbortController().signal, binding)).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
  expect(f.client.readPublicEndpoint).not.toHaveBeenCalled(); expect(f.client.generateKey).not.toHaveBeenCalled()
  expect(f.ports.revoke).not.toHaveBeenCalled()
})
it('does not supersede current-account synchronization with a stale other-account confirmation', async () => {
  const f = fixture(); const signal = new AbortController().signal
  const current = f.sync.sync(false, signal)
  const stale = f.sync.sync(true, signal, { orgId: 'other', userId: 'user', generation: 'generation' })
  expect((await current).status).toBe('ready')
  await expect(stale).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' })
  expect(f.client.generateKey).not.toHaveBeenCalled()
})

it('restores per-model context, images and exact reasoning levels from the release catalog', () => {
  const declared = { id: 'allowed', contextWindow: 1048576, maxOutputTokens: 32768,
    inputModalities: ['text', 'image'] as const, supportsTools: true, supportsReasoning: true,
    reasoningLevels: ['low', 'high', 'max'] as const, thinkingFormat: 'deepseek' as const }
  expect(nativeCapabilities([{ id: 'allowed' }], ['allowed'], undefined, [declared]))
    .toEqual([{ id: 'allowed', contextWindow: 1048576, maxTokens: 32768, input: ['text', 'image'],
      reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
      compat: { maxTokensField: 'max_tokens', supportsReasoningEffort: true, thinkingFormat: 'deepseek' } }])
  expect(nativeCapabilities([{ id: 'allowed', contextWindow: 262144, inputModalities: ['text'],
    supportsVision: false, supportsReasoning: false }], ['allowed'], undefined, [declared]))
    .toEqual([{ id: 'allowed', contextWindow: 262144, maxTokens: 32768, input: ['text'],
      reasoningEfforts: false, compat: { maxTokensField: 'max_tokens', supportsReasoningEffort: true, thinkingFormat: 'deepseek' } }])
  expect(nativeCapabilities([{ id: 'allowed' }], [], undefined, [declared])).toEqual([])
})

it('keeps model-specific request dialects distinct when parsing plugin configuration', () => {
  const model = { id: 'vision', contextWindow: 1048576, maxOutputTokens: 32768,
    inputModalities: ['text', 'image'], supportsTools: true, supportsReasoning: true,
    reasoningLevels: ['low', 'high', 'max'] } satisfies ModelCatalogEntry
  const parsed = Provisioning.Config({ modelCatalog: [model, { ...model, id: 'deepseek', thinkingFormat: 'deepseek' }] })
  expect(parsed.modelCatalog[0]?.thinkingFormat).toBeUndefined()
  expect(parsed.modelCatalog[1]?.thinkingFormat).toBe('deepseek')
})
