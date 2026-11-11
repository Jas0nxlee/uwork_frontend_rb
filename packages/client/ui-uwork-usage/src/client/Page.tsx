/** Read-only enterprise quota and aggregate presentation. */
import { useState, type ReactNode } from 'react'
import { Button, IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { UsageMetric, UsagePeriod } from '@deepseek-ai/dsh-uwork-gateway/types'
import type {} from './types.ts'
import type {} from './locales.ts'
import css from './Page.module.css'
import { plotTrend } from './trend.ts'

/** Usage main panel props supplied by the renderer. */
export type UsagePageProps = PropsRuntime<'main'> & PropsLocale<'uworkUsage'>

/** Render aggregate filters, safe availability states, quotas and usage breakdowns.
 * @param props - Localized copy and standard resource hook.
 * @returns Responsive read-only enterprise usage panel.
 */
export function UsagePage({ t, useResource }: UsagePageProps): ReactNode {
  const [period, setPeriod] = useState<UsagePeriod>('7d')
  const [metric, setMetric] = useState<UsageMetric>('requests')
  const [revision, setRevision] = useState(0)
  const resource = useResource<'uwork-usage'>(`dsh-resource://uwork-usage/${period}/${metric}/${revision}`)
  const page = resource.value
  const loading = resource.status === 'loading' || page?.status === 'loading'
  const state = page?.status === 'ready' ? page.usage : undefined
  const observation = state?.status === 'ready' ? state : state?.status === 'error' ? state.lastSuccess : undefined
  const usage = observation?.data
  const overviewState = page?.status === 'ready' ? page.overview : undefined
  const overview = overviewState?.status === 'ready' ? overviewState : overviewState?.status === 'error' ? overviewState.lastSuccess : undefined
  const points = plotTrend(usage?.trend.map(item => ({
    id: item.date, value: metric === 'requests' ? item.requestCount : metric === 'cost' ? item.cost : item.tokens,
  })) ?? [])
  return <section className={css.page} aria-label={t('title')} aria-busy={loading}>
    <header className={css.header}><h1>{t('title')}</h1>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</Button>
    </header>
    <div className={css.filters}>
      <label>{t('period')}<select value={period} onChange={(event) => { setPeriod(event.target.value as UsagePeriod) }}>
        <option value="7d">{t('week')}</option><option value="month">{t('month')}</option><option value="30d">{t('thirtyDays')}</option>
      </select></label>
      <label>{t('metric')}<select value={metric} onChange={(event) => { setMetric(event.target.value as UsageMetric) }}>
        <option value="requests">{t('requests')}</option><option value="cost">{t('cost')}</option><option value="tokens">{t('tokens')}</option>
      </select></label>
    </div>
    {(resource.status === 'failed' || page?.status === 'unavailable' || state?.status === 'error' || overviewState?.status === 'error') && <p role="alert" className={css.failure}>{t('failed')}</p>}
    {page?.status === 'signed-out' && <p className={css.empty}>{t('signedOut')}</p>}
    {loading && <div className={css.skeleton} role="status" aria-label={t('loading')} />}
    {state?.status === 'error' && state.lastSuccess !== undefined && <p className={css.meta}>{t('retained', { time: new Date(state.lastSuccess.updatedAt).toLocaleString() })}</p>}
    {overview !== undefined && <section className={css.section}><h2>{t('accountDetails')}</h2>
      <dl className={css.details}>
        <div><dt>{t('organization')}</dt><dd>{overview.data.organizationName}</dd></div>
        <div><dt>{t('user')}</dt><dd>{overview.data.userName}</dd></div>
        <div><dt>{t('endpoint')}</dt><dd>{overview.data.publicEndpoint}</dd></div>
      </dl>
      <h2>{t('keys')}</h2>
      {overview.data.keys.length === 0 ? <p className={css.meta}>{t('noKeys')}</p> : <ul className={css.plans}>
        {overview.data.keys.map(key => <li key={key.id}><span>{key.alias ?? t('unnamedKey')}</span><code>{key.maskedKey}</code><span>{key.status}</span></li>)}
      </ul>}
      {overviewState?.status === 'error' && <p className={css.meta}>{t('retained', { time: new Date(overview.updatedAt).toLocaleString() })}</p>}
    </section>}
    {usage !== undefined && <>
      <p className={css.meta}>{t('range', { from: usage.from, until: usage.until })}</p>
      <dl className={css.metrics}>
        <div><dt>{t('requests')}</dt><dd>{usage.summary.requestCount.toLocaleString()}</dd></div>
        <div><dt>{t('success')}</dt><dd>{(usage.summary.successRate * 100).toLocaleString()}%</dd></div>
        <div><dt>{t('cost')}</dt><dd>{usage.summary.cost.toLocaleString()}</dd><dd className={css.meta}>{t('unspecified')}</dd></div>
        <div><dt>{t('tokens')}</dt><dd>{usage.summary.totalTokens.toLocaleString()}</dd></div>
      </dl>
      <section className={css.section}><h2>{t('trend')}</h2>
        {points.length > 0 && <svg className={css.chart} viewBox="0 0 600 160" role="img" aria-label={t('trend')}>
          <title>{t('trend')}</title>
          <line className={css.guide} x1="16" y1="144" x2="584" y2="144" />
          <polyline className={css.line} points={points.map(point => `${point.x},${point.y}`).join(' ')} />
          {points.map(point => <circle className={css.point} key={point.id} cx={point.x} cy={point.y} r="3" />)}
        </svg>}
        {usage.trend.length === 0 ? <p className={css.meta}>{t('empty')}</p> : <div className={css.tableWrap}><table>
          <thead><tr><th>{t('date')}</th><th>{t(metric)}</th></tr></thead>
          <tbody>{usage.trend.map(item => <tr key={item.date}><td>{item.date}</td><td>{(metric === 'requests' ? item.requestCount : metric === 'cost' ? item.cost : item.tokens).toLocaleString()}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className={css.section}><h2>{t('models')}</h2>
        {usage.models.length === 0 ? <p className={css.meta}>{t('empty')}</p> : <div className={css.tableWrap}><table>
          <thead><tr><th>{t('model')}</th><th>{t('requests')}</th><th>{t('share')}</th><th>{t('cost')}</th></tr></thead>
          <tbody>{usage.models.map(item => <tr key={item.model}>
            <td>{item.model}</td><td>{item.requestCount.toLocaleString()}</td>
            <td>{item.share.toLocaleString()}</td><td>{item.cost.toLocaleString()}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>}
    {overview !== undefined && <section className={css.section}><h2>{t('subscriptions')}</h2>
      <p className={css.meta}>{t('unspecified')}</p>
      {overview.data.subscriptions.length === 0 ? <p className={css.meta}>{t('noSubscription')}</p> : <ul className={css.plans}>
        {overview.data.subscriptions.map(plan => <li key={plan.planId}><span>{plan.planTitle}</span><span>{t('balance', { used: plan.amountUsed, total: plan.amountTotal })}</span></li>)}
      </ul>}
    </section>}
  </section>
}

/** Reuse the native data glyph for the sidebar's usage entry.
 * @param props - Sidebar-provided icon geometry.
 * @returns Theme-inheriting existing icon.
 */
export function UsageIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <IconDataOutlineRegular size={size} />
}
