/** Layout-neutral UWork surface around native pending interactions. */
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './InteractionFrame.module.css'

/**
 * Keep one wrapper identity while the native resident composer changes takeover.
 * @param props - Presentation discriminator and unchanged native children.
 * @returns The original chain inside a layout-neutral surface scope.
 */
export function InteractionFrame({ interactionKind, children }: ComposedProps<'conversation.composer.frame', never, never, undefined, object>) {
  const active = interactionKind === 'approval' || interactionKind === 'question' || interactionKind === 'plan-review'
  return <div className={active ? `${css.seat} ${css.frame}` : css.seat} data-uwork-interaction={active ? interactionKind : undefined}>{children}</div>
}
