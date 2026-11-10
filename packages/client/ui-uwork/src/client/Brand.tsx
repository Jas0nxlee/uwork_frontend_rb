/** Apache-2.0 UWork artwork adaptation; source and full license are retained under licenses/. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeroFrameOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Brand.module.css'

const UWORK_MARK_PATH = 'M40 40 A28 28 0 0 1 96 40 L96 128 A32 32 0 0 0 160 128 L160 40 A28 28 0 0 1 216 40 L216 128 A88 88 0 0 1 40 128 Z'

/**
 * Render the source U mark at the Sidebar's requested size.
 * @param props - brand-mark presentation supplied by the Sidebar.
 * @returns color-inheriting decorative artwork.
 */
export function UWorkMark({ size }: PropsRuntime<'sidebar.brand.mark'>): ReactNode {
  return <svg data-uwork-mark="" width={size} height={size} viewBox="0 0 256 228" fill="currentColor" aria-hidden="true">
    <path d={UWORK_MARK_PATH} />
  </svg>
}

/**
 * Render the same U mark within the home owner's geometry.
 * @param props - requested size and home mark styling.
 * @returns decorative home artwork.
 */
export function UWorkHeroMark({ size, className }: PropsRuntime<'conversation.hero.brand.mark'>): ReactNode {
  return <svg data-uwork-mark="" width={size} height={size} className={className} viewBox="0 0 256 228" fill="currentColor" aria-hidden="true">
    <path d={UWORK_MARK_PATH} />
  </svg>
}

/**
 * Render source wordmark geometry with the surrounding theme's ink.
 * @param props - localized product spelling.
 * @returns compact Sidebar wordmark.
 */
export function UWorkName({ t }: PropsLocale<'uworkBrand'>): ReactNode {
  return <span data-uwork-name="" className={css.sidebarWordmark} role="img" aria-label={t('name')} />
}

/**
 * Render the wordmark at the blank home's headline size.
 * @param props - localized product spelling.
 * @returns home title artwork.
 */
export function UWorkTitle({ t }: PropsLocale<'uworkBrand'>): ReactNode {
  return <span data-uwork-title="" className={css.heroWordmark} role="img" aria-label={t('name')} />
}

/** Conversation-owned home phase and wrapped scroll body. */
type UWorkFrameProps = HeroFrameOwnerProps & { readonly children: ReactNode }

/**
 * Place UCAS decoration beneath blank-home content without remounting the resident composer.
 * @param props - home visibility and the existing scroll body.
 * @returns layout-neutral decoration and the unchanged children.
 */
export function UWorkFrame({ hero, children }: UWorkFrameProps): ReactNode {
  return <div className={css.frame}>
    {hero && <div className={css.ucas} data-uwork-home-background="UCAS" aria-hidden="true" />}
    {children}
  </div>
}
