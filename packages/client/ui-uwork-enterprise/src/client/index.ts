/** Enterprise account and model settings over safe generated Remote methods. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import identityRemote from '@deepseek-ai/dsh-uwork-enterprise/remote'
import modelRemote from '@deepseek-ai/dsh-uwork-model-provisioning/remote'
import { EnterpriseMutations, enterpriseOwner, type EnterpriseFace } from './store.ts'
import { EnterpriseSection } from './Section.tsx'
import { openAccount, openModels } from './resource.ts'
import { dictionaries } from './locales.ts'

export const inject = ['remote', 'connection', 'resources', 'slots', 'locale']

/** Mount safe namespaces and publish observations through standard resources.
 * @param ctx - Client root context.
 * @returns Removal of both generated Remote namespaces.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountIdentity = await ctx.remote.$mount(identityRemote)
  let unmountModels: () => Promise<void>
  try { unmountModels = await ctx.remote.$mount(modelRemote) } catch (error) { await unmountIdentity(); throw error }
  ctx.inject(['remote.uworkIdentity', 'remote.uworkModelProvisioning'], (scope) => {
    const connection = scope.get('connection') as ConnectionHandle
    const mutations = new EnterpriseMutations(scope.remote.uworkIdentity, scope.remote.uworkModelProvisioning)
    scope.effect(() => () => { mutations.dispose() }, 'uwork.enterprise.mutations')
    scope.effect(() => scope.locale.register('uworkEnterprise', dictionaries), 'uwork.enterprise.copy')
    scope.effect(() => scope.resources.register<'uwork-enterprise'>({ protocol: 'uwork-enterprise',
      open: (address, { signal }) => openAccount(scope.remote.uworkIdentity, signal,
        new URL(address).searchParams.get('connection') !== 'undefined'),
    }), 'uwork.enterprise.resource')
    scope.effect(() => scope.resources.register<'uwork-enterprise-models'>({ protocol: 'uwork-enterprise-models',
      open: (address, { signal }) => {
        const url = new URL(address)
        return openModels(scope.remote.uworkModelProvisioning, url.searchParams.get('authenticated') === 'true', signal, {
          owner: url.searchParams.get('owner') ?? '', completedCreation: Number(url.searchParams.get('completed')),
          readIdentity: () => scope.remote.uworkIdentity.getState(), connection: () => connection.generation.getSnapshot()?.id,
          settled: (owner, completed) => { mutations.acceptModelRead(owner, completed) },
        })
      },
    }), 'uwork.enterprise.model-resource')
    const face: EnterpriseFace = {
      hooks: { mutations: mutations.store, enterpriseConnection: connection.generation },
      signOut: owner => mutations.signOut(owner), enterOwner: (owner) => { mutations.enterOwner(owner) },
      createManagedKey: (owner, expected) => {
        if (owner !== enterpriseOwner(connection.generation.getSnapshot()?.id, expected)) return Promise.resolve()
        return mutations.createManagedKey(owner, expected)
      },
    }
    const t = scope.locale.bind('uworkEnterprise')
    scope.effect(() => scope.slots.inject('settings.section', () => scope.slots.register({
      name: 'settings.section', id: 'uwork-enterprise', order: -20, locale: 'uworkEnterprise', label: () => t('title'),
      inject: () => face,
    }, EnterpriseSection)), 'uwork.enterprise.settings')
  })
  return async () => { await unmountModels(); await unmountIdentity() }
}
