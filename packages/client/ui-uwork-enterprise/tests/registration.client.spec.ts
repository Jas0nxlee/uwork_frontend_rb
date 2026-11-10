// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { EnterpriseFace } from '../src/client/store.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}
it.each([true, false])('owns safe namespace and resource lifetimes (declaration first=%s)', async (first) => {
  const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); hostApply()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const namespace = {
    getState: vi.fn().mockResolvedValue({ ok: true, value: { status: 'authenticated', orgId: 'org-a', userId: 'user-a', name: 'User A', expiresAt: 2000, generation: 'gen-a' } }),
    listOrganizations: vi.fn().mockResolvedValue({ ok: true, value: { organizations: [] } }),
    watchState: vi.fn(async function* () { yield { status: 'signed-out' } }),
    signOut: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  }
  const models = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { status: 'key-required' } }), createManagedKey: vi.fn().mockResolvedValue({ ok: true, value: { status: 'ready' } }) }
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { $mount: vi.fn(async () => unmount), uworkIdentity: namespace, uworkModelProvisioning: models } as never)
  ctx.provide('remote.uworkIdentity', namespace as never); ctx.provide('remote.uworkModelProvisioning', models as never)
  const generation = createSnapshotStore<{ id: number; host: { home: string } } | undefined>(undefined)
  ctx.provide('connection', { generation } as never)
  const providers: Array<ResourceProvider<'uwork-enterprise' | 'uwork-enterprise-models'>> = []
  ctx.provide('resources', { register: (provider: ResourceProvider<'uwork-enterprise' | 'uwork-enterprise-models'>) => { providers.push(provider); return () => {} } } as never)
  const declare = () => ctx.effect(() => slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null))
  let undeclare = first ? declare() : undefined
  const fiber = ctx.plugin({ inject, apply }); await fiber.await()
  if (!first) { undeclare = declare(); await Promise.resolve() }
  const entry = slots.entries('settings.section')[0]!
  expect(resolveSlotLabel(entry.options.label)).toBe('Enterprise account')
  const face = entry.inject!() as Partial<EnterpriseFace>
  const expected = { orgId: 'org-a', userId: 'user-a', generation: 'gen-a' }
  const owner = JSON.stringify([1, expected.orgId, expected.userId, expected.generation])
  await face.createManagedKey!(owner, expected)
  expect(models.createManagedKey).not.toHaveBeenCalled()
  generation.set({ id: 1, host: { home: '/host-a' } })
  await face.signOut!(owner); face.enterOwner!(owner); await face.createManagedKey!(owner, expected)
  expect(namespace.signOut).toHaveBeenCalledOnce(); expect(models.createManagedKey).toHaveBeenCalledOnce()
  generation.set({ id: 2, host: { home: '/host-b' } })
  await face.createManagedKey!(owner, expected)
  expect(models.createManagedKey).toHaveBeenCalledOnce()
  models.refresh.mockResolvedValue({ ok: true, value: { status: 'ready', provider: 'managed', modelIds: [], needsModelSelection: false } })
  for (const provider of providers) await collect(provider.open('dsh-resource://'+provider.protocol+'/account?connection=2&authenticated=true&completed=1&owner='+encodeURIComponent(JSON.stringify([2, expected.orgId, expected.userId, expected.generation])), { signal: new AbortController().signal }))
  expect(models.refresh).toHaveBeenCalledOnce()
  const modelProvider = providers.find(provider => provider.protocol === 'uwork-enterprise-models')!
  const invalidOwner = await collect(modelProvider.open('dsh-resource://uwork-enterprise-models/models?authenticated=true', { signal: new AbortController().signal }))
  expect(invalidOwner).toMatchObject([{ ok: false }])
  await undeclare?.(); expect(slots.entries('settings.section')).toHaveLength(0)
  declare(); await Promise.resolve(); expect(slots.entries('settings.section')).toHaveLength(1)
  await fiber.dispose(); expect(slots.entries('settings.section')).toHaveLength(0)
  expect(unmount).toHaveBeenCalledTimes(2)
})
it('withdraws the identity namespace if model namespace mounting fails', async () => {
  const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
  const unmount = vi.fn(async () => {})
  ctx.provide('remote', { $mount: vi.fn().mockResolvedValueOnce(unmount).mockRejectedValueOnce(new Error('unavailable')) } as never)
  await expect(apply(ctx)).rejects.toThrow('unavailable')
  expect(unmount).toHaveBeenCalledOnce()
})
