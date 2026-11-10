/** UWork conversation presentation on native, identity-stable composition layers. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ConversationFrame, ComposerFrame } from './Frames.tsx'

/** Effect-owned composition and theme layers. */
export const inject = ['slots', 'theme']

/**
 * Register product presentation without replacing native business controls or stores.
 * @param ctx - Client root with the native conversation owners.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.theme.overrideTokens('@deepseek-ai/dsh-client-ui-uwork-conversation', {
    '--dsw-specific-bubble': { light: '#e6e6e6', dark: '#363636' },
  }), 'uwork.conversation.palette')
  ctx.effect(() => ctx.slots.inject('conversation.hero.frame', () =>
    ctx.slots.register({ name: 'conversation.hero.frame', id: 'uwork-conversation', order: 10 }, ConversationFrame)), 'uwork.conversation.frame')
  ctx.effect(() => ctx.slots.inject('conversation.composer.frame', () =>
    ctx.slots.register({ name: 'conversation.composer.frame', id: 'uwork-composer', order: 10 }, ComposerFrame)), 'uwork.conversation.composer')
}
