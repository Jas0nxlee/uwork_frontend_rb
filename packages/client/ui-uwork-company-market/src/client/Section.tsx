/** Public company skill browsing, without npm install actions. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketFace } from './store.ts'
import css from './Section.module.css'

/** Company catalog tab props bound by the slot renderer. */
export type CompanyMarketProps = PropsRuntime<'plugins.tab'> & PropsLocale<'uworkCompanyMarket'> & InjectFace<MarketFace>

/**
 * Browse a public catalog, retaining its last result after a failed refresh.
 * @param props - injected query state, actions and localized copy.
 * @returns search, catalog rows and result pagination.
 */
export function CompanyMarketSection({ t, useMarket, start, load }: CompanyMarketProps): ReactNode {
  const state = useMarket(snapshot => snapshot)
  const [draft, setDraft] = useState(state.text)
  useEffect(start, [start])
  const value = state.value
  const nextPage = value === null ? null : value.nextPage
  return <section className={css.section} aria-label={t('title')} aria-busy={state.status === 'loading'}>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); load(draft, 0) }}>
      <Input className={css.search as string} value={draft} aria-label={t('search')} placeholder={t('search')}
        onChange={(event) => { setDraft(event.target.value) }} />
      <Button type="submit" variant="outline" size="sm">{t('submit')}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => { load(state.text, state.page) }}>{t('refresh')}</Button>
    </form>
    {state.status === 'error' && <div className={css.failure} role="alert">
      <span>{t(state.failure)}</span>
      <Button variant="ghost" size="sm" onClick={() => { load(state.text, state.page) }}>{t('retry')}</Button>
    </div>}
    {value !== null && state.status !== 'ready' && <p className={css.meta}>{t('retained')}</p>}
    {value === null && (state.status === 'idle' || state.status === 'loading') && <div role="status" aria-label={t('loading')}>
      {[0, 1, 2].map(key => <div key={key} className={css.skeleton} aria-hidden="true" />)}
    </div>}
    {value !== null && <>
      <p className={css.meta}>{t('source', { source: value.source })}</p>
      <p className={css.meta}>{t('total', { count: value.total })}</p>
      {value.items.length === 0 ? <p className={css.meta}>{t('empty')}</p> : <ul className={css.list}>
        {value.items.map(skill => <li key={skill.slug} className={css.card}>
          <div className={css.heading}><span className={css.title}>{skill.title}</span><span className={css.meta}>{t('version', { version: skill.version })}</span></div>
          <p className={css.meta}>{skill.slug}</p>
          <p className={css.summary}>{skill.summary}</p>
        </li>)}
      </ul>}
      <nav className={css.toolbar} aria-label={t('page', { page: value.page + 1 })}>
        <Button variant="ghost" size="sm" disabled={value.page === 0 || state.status !== 'ready'} onClick={() => { load(state.text, value.page - 1) }}>{t('previous')}</Button>
        <span className={css.meta}>{t('page', { page: value.page + 1 })}</span>
        <Button variant="ghost" size="sm" disabled={nextPage === null || state.status !== 'ready'} onClick={nextPage === null ? undefined : () => { load(state.text, nextPage) }}>{t('next')}</Button>
      </nav>
    </>}
  </section>
}
