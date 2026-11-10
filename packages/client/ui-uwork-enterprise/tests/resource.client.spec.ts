import { expect, it, vi } from 'vitest'
import type { IdentityState } from '@deepseek-ai/dsh-uwork-enterprise/types'
import { RemoteError, type TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { openAccount, openModels, type ModelReadProof } from '../src/client/resource.ts'
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
const failure = { ok: false as const, error: { code: 'test/failure', message: 'private', details: {} } }
function bench() {
  const controller = new AbortController()
  const identity = {
    listOrganizations: vi.fn().mockResolvedValue({ ok: true, value: { organizations: [{ orgId: 'org-a', label: 'Org A' }] } }),
    watchState: vi.fn(async function* () { yield { status: 'authenticated', orgId: 'org-a', name: 'Test', userId: 'user-1', expiresAt: 2000, generation: 'g-a' }; yield { status: 'signed-out' } }),
  }
  const connection = vi.fn(() => 1)
  const proof: ModelReadProof & { readIdentity: ReturnType<typeof vi.fn<TypertClientRemote['uworkIdentity']['getState']>> } = {
    owner: JSON.stringify([1, 'org-a', 'user-1', 'g-a']), completedCreation: 1,
    readIdentity: vi.fn<TypertClientRemote['uworkIdentity']['getState']>().mockResolvedValue({ ok: true, value: { status: 'authenticated', orgId: 'org-a', userId: 'user-1', name: 'Test', expiresAt: 2000, generation: 'g-a' } as IdentityState }),
    connection, settled: vi.fn(),
  }
  const models = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { status: 'key-required' } }) }
  return { controller, identity, models, proof, connection }
}
it('publishes authoritative identity changes with public organization labels', async () => {
  const h = bench()
  const values = await collect(openAccount(h.identity as never, h.controller.signal))
  expect(values).toMatchObject([{ ok: true, value: { identity: { status: 'authenticated' }, organizations: [{ label: 'Org A' }] } }, { ok: true, value: { identity: { status: 'signed-out' } } }])
})
it.each(['refused', 'throw', 'aborted', 'stream-aborted', 'aborted-throw'] as const)('handles %s account provider lifetime', async (kind) => {
  const h = bench()
  if (kind === 'refused') h.identity.listOrganizations.mockResolvedValue(failure)
  if (kind === 'throw' || kind === 'aborted-throw') h.identity.listOrganizations.mockRejectedValue(new Error('credential-containing diagnostic'))
  if (kind === 'aborted' || kind === 'aborted-throw') h.controller.abort()
  if (kind === 'stream-aborted') h.identity.watchState.mockImplementation(async function* () { h.controller.abort(); yield { status: 'signed-out' } })
  const values = await collect(openAccount(h.identity as never, h.controller.signal))
  expect(values.length).toBe(kind.includes('aborted') ? 0 : 1)
  if (kind === 'throw') expect(JSON.stringify(values)).not.toContain('credential-containing')
})
it.each(['ready', 'refused', 'throw', 'aborted', 'aborted-throw', 'signed-out'] as const)('reads %s models without any key creation API', async (kind) => {
  const h = bench()
  if (kind === 'refused') h.models.refresh.mockResolvedValue(failure)
  if (kind === 'throw' || kind === 'aborted-throw') h.models.refresh.mockRejectedValue(new Error('private'))
  if (kind === 'aborted' || kind === 'aborted-throw') h.controller.abort()
  const values = await collect(openModels(h.models as never, kind !== 'signed-out', h.controller.signal, h.proof))
  expect(values.length).toBe(kind.includes('aborted') ? 0 : 1)
  expect(h.models.refresh).toHaveBeenCalledTimes(kind === 'signed-out' ? 0 : 1)
})
it('does not read old Host identity while disconnected', async () => {
  const h = bench()
  const values = await collect(openAccount(h.identity as never, h.controller.signal, false))
  expect(values).toMatchObject([{ ok: false }])
  expect(h.identity.listOrganizations).not.toHaveBeenCalled()
})
it.each(['ready', 'capabilities-required'] as const)('settles %s only after the same account and connection verify the fresh read', async (status) => {
  const h = bench()
  h.models.refresh.mockResolvedValue({ ok: true, value: status === 'ready' ? { status, provider: 'managed', modelIds: [], needsModelSelection: false } : { status } })
  const values = await collect(openModels(h.models as never, true, h.controller.signal, h.proof))
  expect(values).toMatchObject([{ ok: true, value: { status } }])
  expect(h.proof.settled).toHaveBeenCalledWith(h.proof.owner, 1)
})
it.each(['identity-failed', 'signed-out', 'new-host', 'aborted-identity', 'identity-throw'] as const)('does not publish or settle a model read after %s', async (kind) => {
  const h = bench()
  h.models.refresh.mockResolvedValue({ ok: true, value: { status: 'ready', provider: 'managed', modelIds: [], needsModelSelection: false } })
  if (kind === 'identity-failed') h.proof.readIdentity.mockResolvedValue({ ok: false, error: new RemoteError('uwork-enterprise/unavailable', 'Unavailable', {}) })
  if (kind === 'signed-out') h.proof.readIdentity.mockResolvedValue({ ok: true, value: { status: 'signed-out' } })
  if (kind === 'new-host') h.connection.mockReturnValue(2)
  if (kind === 'identity-throw') h.proof.readIdentity.mockRejectedValue(new Error('private issuer diagnostic'))
  if (kind === 'aborted-identity') h.proof.readIdentity.mockImplementation(async () => { h.controller.abort(); return { ok: true, value: { status: 'signed-out' } } })
  const values = await collect(openModels(h.models as never, true, h.controller.signal, h.proof))
  expect(values).toMatchObject(kind === 'aborted-identity' ? [] : [{ ok: false }])
  expect(h.proof.settled).not.toHaveBeenCalled()
})
