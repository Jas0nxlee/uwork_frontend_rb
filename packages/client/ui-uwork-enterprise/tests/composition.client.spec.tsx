// @vitest-environment jsdom
/** Production resources, framework-made hooks, identity stream and native settings outlet. */
import type { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { IdentityState } from '@deepseek-ai/dsh-uwork-enterprise/types'
import type { ModelProvisioningState } from '@deepseek-ai/dsh-uwork-model-provisioning/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { apply as resourcesApply, inject as resourcesInject } from '../../resources/src/client/index.ts'
import { EnterpriseMutations, type ManagedKeyBinding } from '../src/client/store.ts'
import { EnterpriseSection } from '../src/client/Section.tsx'
import { dictionaries } from '../src/client/locales.ts'
import { openAccount, openModels } from '../src/client/resource.ts'

function Settings({ renderSlot }: PropsRenderSlots<'settings.section'>) { return renderSlot('settings.section', { close: () => {} }) }
it('clears old account and models on logout or Host replacement, and confirms key creation exactly once', async () => {
  const runtime = await SlotTestRuntime.create(); onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx); locale.setLocale('en'); runtime.ctx.provide('locale', locale); runtime.ctx.slots.installLocale(locale)
  await runtime.mount({ inject: resourcesInject, apply: resourcesApply })
  let identity = { status: 'authenticated', orgId: 'org-a', name: 'First Host User', userId: 'user-a', generation: 'generation-a', expiresAt: 2000 } as IdentityState
  const listeners = new Set<() => void>()
  const remote = {
    listOrganizations: vi.fn().mockResolvedValue({ ok: true, value: { organizations: [{ orgId: 'org-a', label: 'Organization A with a long name for wrapping' }] } }),
    async *watchState(signal: AbortSignal) {
      while (!signal.aborted) {
        yield identity
        await new Promise<undefined>((resolve) => {
          const done = () => { signal.removeEventListener('abort', done); listeners.delete(done); resolve(undefined) }
          listeners.add(done); signal.addEventListener('abort', done, { once: true })
        })
      }
    },
    signOut: vi.fn(async () => ({ ok: true, value: undefined })),
  }
  const models = { refresh: vi.fn().mockResolvedValue({ ok: true, value: { status: 'key-required' } }), createManagedKey: vi.fn().mockResolvedValue({ ok: true, value: { status: 'key-outcome-unknown' } }) }
  const mutations = new EnterpriseMutations(remote as never, models)
  const staleModelRead = Promise.withResolvers<RemoteResult<ModelProvisioningState>>()
  const connection = createSnapshotStore<ConnectionGeneration | undefined>({ id: 1, host: { home: '/host-a' } })
  await runtime.root.declare({ 'settings.section': { kind: 'list', scope: 'root' } }, Settings)
  await runtime.mount({
    inject: ['slots', 'resources'],
    apply(ctx: Context) {
      ctx.effect(() => locale.register('uworkEnterprise', dictionaries))
      ctx.effect(() => () => { mutations.dispose() })
      ctx.effect(() => ctx.resources.register<'uwork-enterprise'>({ protocol: 'uwork-enterprise', open: (address, { signal }) => openAccount(remote as never, signal, new URL(address).searchParams.get('connection') !== 'undefined') }))
      ctx.effect(() => ctx.resources.register<'uwork-enterprise-models'>({ protocol: 'uwork-enterprise-models',
        async *open(address, { signal }) {
          const url = new URL(address)
          yield* openModels(models as never, url.searchParams.get('authenticated') === 'true', signal, {
            owner: url.searchParams.get('owner') ?? '', completedCreation: Number(url.searchParams.get('completed')),
            readIdentity: async () => ({ ok: true, value: identity }), connection: () => connection.getSnapshot()?.id,
            settled: (owner, completed) => { mutations.acceptModelRead(owner, completed) },
          })
          // Deliberately late old-holder frame proves native resources cannot clear uncertainty with pre-POST data.
          if (url.searchParams.get('authenticated') === 'true' && url.searchParams.get('connection') === '1'
            && url.searchParams.get('completed') === '0') yield await staleModelRead.promise
        },
      }))
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'enterprise', locale: 'uworkEnterprise', inject: () => ({
        hooks: { mutations: mutations.store, enterpriseConnection: connection },
        signOut: (owner: string) => mutations.signOut(owner),
        enterOwner: (owner: string) => { mutations.enterOwner(owner) },
        createManagedKey: (owner: string, expected: ManagedKeyBinding) => mutations.createManagedKey(owner, expected),
      }) }, EnterpriseSection))
    },
  })
  const view = runtime.renderRoot()
  await view.findByText('First Host User')
  fireEvent.click(await view.findByRole('button', { name: 'Create managed key' }))
  expect(models.createManagedKey).not.toHaveBeenCalled()
  fireEvent.click(within(view.getByRole('dialog', { name: 'Create a managed key?' })).getByRole('button', { name: 'Create key on server' }))
  await view.findByText('Key creation could not be confirmed. Check with your administrator before creating another key.')
  expect(models.createManagedKey).toHaveBeenCalledOnce()
  expect(view.queryByRole('button', { name: 'Create managed key' })).toBeNull()
  await act(async () => {
    staleModelRead.resolve({ ok: true, value: { status: 'ready', provider: 'opaque-provider-id', modelIds: ['old-model'], needsModelSelection: true } })
    await Promise.resolve()
  })
  expect(view.queryByText('old-model')).toBeNull()
  expect(mutations.store.getSnapshot().createUnknown).toBe(true)
  models.refresh.mockResolvedValue({ ok: true, value: { status: 'ready', provider: 'opaque-provider-id', modelIds: ['reconciled-model'], needsModelSelection: true } })
  fireEvent.click(view.getByRole('button', { name: 'Refresh models' }))
  await view.findByText('reconciled-model')
  await waitFor(() => { expect(mutations.store.getSnapshot().createUnknown).toBe(false) })
  expect(view.queryByText('opaque-provider-id')).toBeNull()
  expect(models.createManagedKey).toHaveBeenCalledOnce()
  models.refresh.mockResolvedValue({ ok: true, value: { status: 'key-required' } })
  act(() => { identity = { status: 'signed-out' }; for (const listener of [...listeners]) listener() })
  await view.findByText('Return to the sign-in window to continue.')
  expect(view.queryByText('First Host User')).toBeNull()
  expect(view.queryByRole('heading', { name: 'UWork managed models' })).toBeNull()
  act(() => { connection.set(undefined) })
  await waitFor(() => { expect(view.queryByText('Return to the sign-in window to continue.')).toBeNull() })
  act(() => {
    identity = { status: 'authenticated', orgId: 'org-a', name: 'New Host User', userId: 'user-a', generation: 'generation-a', expiresAt: 2000 } as IdentityState
    connection.set({ id: 2, host: { home: '/host-b' } })
  })
  await view.findByText('New Host User')
  expect(view.queryByText('First Host User')).toBeNull()
  expect(models.createManagedKey).toHaveBeenCalledOnce()
  await view.findByRole('button', { name: 'Create managed key' })
})
