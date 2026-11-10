/** Enterprise usage is a native main panel and sidebar entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import remote from '@deepseek-ai/dsh-uwork-gateway-service/remote'
export type {} from '@deepseek-ai/dsh-uwork-gateway-service/remote'
import { UsagePage, UsageIcon } from './Page.tsx'
import { dictionaries } from './locales.ts'
import { openUsage } from './resource.ts'

/** Required renderer, locale, resource and transport services. */
export const inject = ['slots', 'locale', 'resources', 'remote']

/** Mount safe enterprise account resources and the usage navigation entry.
 * @param ctx - Client plugin context.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(remote)
  ctx.effect(() => unmount, 'uwork.usage.remote')
  ctx.inject(['remote.uworkGateway'], (scope) => {
    scope.effect(() => scope.locale.register('uworkUsage', dictionaries), 'uwork.usage.copy')
    scope.effect(() => scope.resources.register<'uwork-usage'>({ protocol: 'uwork-usage',
      open: (address, { signal }) => openUsage(scope.remote, address, signal),
    }), 'uwork.usage.resources')
    const t = scope.locale.bind('uworkUsage')
    scope.effect(() => scope.slots.inject('main', () => scope.slots.register({
      name: 'main', key: brandString<MainPanelId>('uwork-usage'), locale: 'uworkUsage',
    }, UsagePage)), 'uwork.usage.page')
    scope.effect(() => scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist', id: 'uwork-usage', locale: 'uworkUsage', label: () => t('title'), order: 1,
    }, UsageIcon)), 'uwork.usage.navigation')
  })
}
