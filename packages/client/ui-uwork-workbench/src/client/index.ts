/** Product-specific docking-surface presentation through the native rightbar's frame slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { WorkbenchFrame } from './WorkbenchFrame.tsx'

/** The native slot registry owns frame declaration and renderer dispatch. */
export const inject = ['slots']

/**
 * Attach product presentation without replacing tab or docking ownership.
 * @param ctx - client plugin lifetime.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('sidebar.right.frame', () =>
    ctx.slots.register({ name: 'sidebar.right.frame', id: 'uwork-workbench' }, WorkbenchFrame)), 'uwork.workbench.frame')
}
