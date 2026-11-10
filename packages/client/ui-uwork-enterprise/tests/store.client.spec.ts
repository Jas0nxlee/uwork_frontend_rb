import { expect, it, vi } from 'vitest'
import { EnterpriseMutations } from '../src/client/store.ts'

function bench() {
  const identity = { signOut: vi.fn().mockResolvedValue({ ok: true, value: undefined }) }
  const models = { createManagedKey: vi.fn().mockResolvedValue({ ok: true, value: { status: 'ready', provider: 'managed', modelIds: ['model-a'], needsModelSelection: true } }) }
  return { identity, models, mutations: new EnterpriseMutations(identity, models) }
}
it.each(['success', 'refused', 'throw'] as const)('handles %s sign-out without caching account facts', async (kind) => {
  const h = bench()
  if (kind === 'refused') h.identity.signOut.mockResolvedValue({ ok: false })
  if (kind === 'throw') h.identity.signOut.mockRejectedValue(new Error('private'))
  const pending = h.mutations.signOut('owner-a')
  await h.mutations.signOut('owner-a')
  expect(h.identity.signOut).toHaveBeenCalledOnce()
  await pending
  expect(h.mutations.store.getSnapshot()).toMatchObject({ signingOut: false, signOutFailed: kind !== 'success' })
})
it.each(['success', 'unknown', 'refused', 'throw'] as const)('never retries %s key creation implicitly', async (kind) => {
  const h = bench()
  if (kind === 'unknown') h.models.createManagedKey.mockResolvedValue({ ok: true, value: { status: 'key-outcome-unknown' } })
  if (kind === 'refused') h.models.createManagedKey.mockResolvedValue({ ok: false })
  if (kind === 'throw') h.models.createManagedKey.mockRejectedValue(new Error('private'))
  const pending = h.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' })
  await h.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' })
  expect(h.models.createManagedKey).toHaveBeenCalledOnce()
  await pending
  expect(h.mutations.store.getSnapshot()).toMatchObject({ creating: false, createUnknown: kind !== 'success' })
  if (kind !== 'success') { await h.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' }); expect(h.models.createManagedKey).toHaveBeenCalledOnce() }
})
it('drops mutation completion after disposal and prevents further calls', async () => {
  const h = bench()
  const logout = h.mutations.signOut('owner-a')
  const creation = h.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' })
  h.mutations.dispose()
  const previous = h.mutations.store.getSnapshot()
  await Promise.all([logout, creation, h.mutations.signOut('owner-a'), h.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' })])
  expect(h.mutations.store.getSnapshot()).toBe(previous)
  expect(h.identity.signOut).toHaveBeenCalledOnce()
  expect(h.models.createManagedKey).toHaveBeenCalledOnce()
  const fresh = bench()
  fresh.mutations.dispose()
  await fresh.mutations.createManagedKey('owner-a', { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' })
  expect(fresh.models.createManagedKey).not.toHaveBeenCalled()
})

const binding = { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' } as never
it('keeps unknown creation local to its owner and allows a newly confirmed owner', async () => {
  const h = bench()
  h.models.createManagedKey.mockResolvedValueOnce({ ok: true, value: { status: 'key-outcome-unknown' } })
  await h.mutations.createManagedKey('owner-a', binding)
  h.mutations.enterOwner('owner-a')
  expect(h.mutations.store.getSnapshot().createUnknown).toBe(true)
  h.mutations.enterOwner('owner-b')
  await h.mutations.createManagedKey('owner-b', binding)
  expect(h.mutations.store.getSnapshot()).toMatchObject({ owner: 'owner-b', createUnknown: false })
  expect(h.models.createManagedKey).toHaveBeenCalledTimes(2)
})
it.each(['signOut', 'create'] as const)('cancels prior %s interaction state on owner replacement', async (kind) => {
  const h = bench()
  const result = Promise.withResolvers<{ ok: boolean; value?: { status: string } }>()
  if (kind === 'signOut') h.identity.signOut.mockReturnValueOnce(result.promise)
  else h.models.createManagedKey.mockReturnValueOnce(result.promise)
  const pending = kind === 'signOut' ? h.mutations.signOut('owner-a') : h.mutations.createManagedKey('owner-a', binding)
  h.mutations.enterOwner('owner-b')
  const invalidated = h.mutations.store.getSnapshot()
  expect(invalidated).toMatchObject({ signingOut: false, creating: false })
  result.resolve({ ok: true, value: { status: 'ready' } })
  await pending
  expect(h.mutations.store.getSnapshot()).toBe(invalidated)
  h.mutations.dispose(); h.mutations.enterOwner('owner-c')
  expect(h.mutations.store.getSnapshot()).toBe(invalidated)
})
it.each(['signOut', 'create'] as const)('never lets an older %s completion overwrite a new owner action', async (kind) => {
  const h = bench()
  const result = Promise.withResolvers<{ ok: boolean; value?: { status: string } }>()
  if (kind === 'signOut') h.identity.signOut.mockReturnValueOnce(result.promise)
  else h.models.createManagedKey.mockReturnValueOnce(result.promise)
  const old = kind === 'signOut' ? h.mutations.signOut('owner-a') : h.mutations.createManagedKey('owner-a', binding)
  const current = kind === 'signOut' ? h.mutations.signOut('owner-b') : h.mutations.createManagedKey('owner-b', binding)
  await current
  const expected = h.mutations.store.getSnapshot()
  result.resolve({ ok: false }); await old
  expect(h.mutations.store.getSnapshot()).toBe(expected)
})
it.each(['signOut', 'create'] as const)('does not merge %s outcome into a different mutation owner', async (kind) => {
  const h = bench()
  const result = Promise.withResolvers<{ ok: boolean; value?: { status: string } }>()
  if (kind === 'signOut') h.identity.signOut.mockReturnValueOnce(result.promise)
  else h.models.createManagedKey.mockReturnValueOnce(result.promise)
  const old = kind === 'signOut' ? h.mutations.signOut('owner-a') : h.mutations.createManagedKey('owner-a', binding)
  if (kind === 'signOut') await h.mutations.createManagedKey('owner-b', binding)
  else await h.mutations.signOut('owner-b')
  const expected = h.mutations.store.getSnapshot()
  result.resolve({ ok: true, value: { status: 'key-outcome-unknown' } }); await old
  expect(h.mutations.store.getSnapshot()).toBe(expected)
})
it('accepts only the matching post-completion read as proof of reconciliation', async () => {
  const h = bench()
  h.models.createManagedKey.mockResolvedValueOnce({ ok: true, value: { status: 'key-outcome-unknown' } })
  const pending = h.mutations.createManagedKey('owner-a', binding)
  h.mutations.acceptModelRead('owner-a', 1)
  await pending
  h.mutations.acceptModelRead('owner-b', 1)
  h.mutations.acceptModelRead('owner-a', 0)
  h.mutations.acceptModelRead('owner-a', 2)
  expect(h.mutations.store.getSnapshot().createUnknown).toBe(true)
  h.mutations.acceptModelRead('owner-a', 1)
  expect(h.mutations.store.getSnapshot().createUnknown).toBe(false)
  h.mutations.acceptModelRead('owner-a', 1)
  h.mutations.dispose(); h.mutations.acceptModelRead('owner-a', 1)
})
