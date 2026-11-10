/** Layout-neutral layers preserve every native message, composer, draft and interaction child. */
import type { ReactNode } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Frames.module.css'

type BodyProps = ComposedProps<'conversation.hero.frame', never, never, undefined, object>
type ComposerProps = ComposedProps<'conversation.composer.frame', never, never, undefined, object>

/**
 * Apply source message, attachment and tool presentation through owner-supported variables.
 * @param props - unchanged native scroll body and home phase.
 * @returns one transparent layer around exactly the existing children.
 */
export function ConversationFrame({ children }: BodyProps): ReactNode {
  return <div className={css.conversation} data-uwork-conversation="">{children}</div>
}

/**
 * Keep input and takeover identity stable while applying the source card geometry.
 * @param props - existing resident composer and optional native interaction kind.
 * @returns the unchanged composer inside a layout-neutral styling layer.
 */
export function ComposerFrame({ children }: ComposerProps): ReactNode {
  return <div className={css.composer} data-uwork-composer="">{children}</div>
}
