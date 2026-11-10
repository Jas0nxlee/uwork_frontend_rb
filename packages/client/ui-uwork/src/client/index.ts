/** UWork brand contributions attach to the standard Sidebar and blank-home extension points. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { UWorkFrame, UWorkMark, UWorkHeroMark, UWorkName, UWorkTitle } from './Brand.tsx'
import { dictionaries } from './locales.ts'
import { uworkTokens } from './theme.ts'
import { UWorkNavigation } from './Navigation.tsx'

/** Required services: effect-owned slots and product copy. */
export const inject = ['slots', 'locale', 'theme']

/**
 * Register UWork presentation until this plugin lifetime ends.
 * @param ctx - Client root containing the shared slot and locale owners.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.theme.overrideTokens('@deepseek-ai/dsh-client-ui-uwork', uworkTokens), 'uwork.theme')
  ctx.effect(() => ctx.slots.inject('sidebar.frame', () =>
    ctx.slots.register({ name: 'sidebar.frame', id: 'uwork-navigation' }, UWorkNavigation)), 'uwork.navigation')
  ctx.effect(() => ctx.locale.register('uworkBrand', dictionaries), 'uwork.brand.copy')
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark' }, UWorkMark)), 'uwork.brand.mark')
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name', locale: 'uworkBrand' }, UWorkName)), 'uwork.brand.name')
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.title', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.title', locale: 'uworkBrand' }, UWorkTitle)), 'uwork.brand.title')
  ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, UWorkHeroMark)), 'uwork.brand.hero-mark')
  ctx.effect(() => ctx.slots.inject('conversation.hero.frame', () =>
    ctx.slots.register({ name: 'conversation.hero.frame', id: 'uwork-home' }, UWorkFrame)), 'uwork.brand.home')
}
