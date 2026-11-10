/** Product presentation leaves native decision and draft owners in control. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InteractionFrame } from './InteractionFrame.tsx'

/** The only dependency is the lifecycle-owned Slot registry. */
export const inject = ['slots']

/** @param ctx - Browser root with native Conversation declarations. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.composer.frame', () =>
    ctx.slots.register({ name: 'conversation.composer.frame', id: 'uwork-interactions' }, InteractionFrame)), 'uwork.interactions')
}
