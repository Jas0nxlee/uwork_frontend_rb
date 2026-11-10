/** Company market tab mounted independently of enterprise sign-in. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import companyMarketRemote from '@deepseek-ai/dsh-uwork-company-market/remote'
import { MarketController } from './store.ts'
import { CompanyMarketSection } from './Section.tsx'
import { dictionaries } from './locales.ts'

/** Remote transport and shared plugin presentation owners. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Mount the catalog Remote and contribute its public tab until this plugin is unloaded.
 * @param ctx - browser root context.
 * @returns removal of the generated Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(companyMarketRemote)
  ctx.inject(['remote.uworkCompanyMarket'], (scope) => {
    const controller = new MarketController(scope.remote.uworkCompanyMarket)
    scope.effect(() => () => { controller.dispose() }, 'uwork.company-market.requests')
    scope.effect(() => scope.locale.register('uworkCompanyMarket', dictionaries), 'uwork.company-market.copy')
    const t = scope.locale.bind('uworkCompanyMarket')
    scope.effect(() => scope.slots.inject('plugins.tab', () => scope.slots.register({
      name: 'plugins.tab', id: 'uwork-company-market', locale: 'uworkCompanyMarket', label: () => t('title'),
      inject: () => controller.face,
    }, CompanyMarketSection)), 'uwork.company-market.tab')
  })
  return unmount
}
