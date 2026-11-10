// @vitest-environment jsdom
/** The production page renders safe aggregate states and locale-owned filters. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { UsagePage, UsageIcon, type UsagePageProps } from '../src/client/Page.tsx'
import { dictionaries, en } from '../src/client/locales.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GatewayKeyId } from '@deepseek-ai/dsh-uwork-gateway/types'
import type { UsagePageData } from '../src/client/types.ts'
import { usage, overview } from './fixtures.client.ts'

afterEach(cleanup)
function mount(data: UsagePageData, failed = false) {
  const addresses: string[] = []
  const props = { t: makeTranslate(en), useResource: (address: string) => {
    addresses.push(address)
    return { status: failed ? 'failed' : 'live', value: data }
  } } as UsagePageProps
  return { ...render(<UsagePage {...props} />), addresses, props }
}
it('renders request, token and quota data without inventing currency and keeps an output snapshot', () => {
  const view = mount({ status: 'ready', overview, usage })
  expect(view.container.textContent).toMatchInlineSnapshot('"Enterprise usageRefreshPeriodLast 7 daysThis monthLast 30 daysMetricRequestsCostTokensGateway and accountOrganizationsynthetic-orgUsersynthetic-userPublic gateway endpointhttps://models.example.com/v1Gateway API keysNo gateway API keys2026-11-01 – 2026-11-07Requests10Success rate90%Cost2.5Accounting unit not specifiedTokens120Daily usageDaily usageDateRequests2026-11-0110Usage by modelModelRequestsShare (server value)Costsynthetic-model101002.5SubscriptionsAccounting unit not specifiedSynthetic subscriptionUsed 25 of 100"')
  expect(view.container.textContent).not.toMatch(/USD|CNY|\$|¥/)
  expect(view.getAllByRole('table')).toHaveLength(2)
  expect(view.getByRole('img', { name: 'Daily usage' })).toBeTruthy()
  expect(view.container.querySelectorAll('circle')).toHaveLength(1)
  fireEvent.change(view.getByLabelText('Period'), { target: { value: 'month' } })
  fireEvent.change(view.getByLabelText('Metric'), { target: { value: 'cost' } })
  fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
  expect(view.addresses.at(-1)).toBe('dsh-resource://uwork-usage/month/cost/1')
  fireEvent.change(view.getByLabelText('Metric'), { target: { value: 'tokens' } })
  expect(view.addresses.at(-1)).toBe('dsh-resource://uwork-usage/month/tokens/1')
})
it('shows loading and signed-out states without zero aggregates', () => {
  const view = mount({ status: 'loading' })
  expect(view.getByRole('status', { name: 'Loading enterprise usage' })).toBeTruthy()
  expect((view.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true)
  view.unmount()
  const signedOut = mount({ status: 'signed-out' })
  expect(signedOut.getByText('Sign in to an enterprise account to view usage.')).toBeTruthy()
  expect(signedOut.queryByText('Success rate')).toBeNull()
})
it('labels retained failures and uses a notice rather than silently displaying current zero values', () => {
  if (overview.status !== 'ready' || usage.status !== 'ready') throw new Error('Synthetic fixtures must be ready')
  const view = mount({ status: 'ready', overview: { status: 'error', reason: 'network', lastSuccess: overview },
    usage: { status: 'error', reason: 'network', lastSuccess: usage } })
  expect(view.getByRole('alert').textContent).toContain('could not be updated')
  expect(view.getAllByText(/Showing results last updated/)).toHaveLength(2)
  expect(view.getByText('synthetic-model')).toBeTruthy()
  view.unmount()
  const absent = mount({ status: 'ready', overview: { status: 'error', reason: 'invalid' }, usage: { status: 'error', reason: 'invalid' } }, true)
  expect(absent.queryByText('Success rate')).toBeNull()
  expect(absent.getByRole('alert')).toBeTruthy()
})
it('handles empty periods and subscriptions and uses existing icon geometry', () => {
  if (usage.status !== 'ready' || overview.status !== 'ready') throw new Error('Synthetic fixture must be ready')
  const view = mount({ status: 'ready', overview: { ...overview, data: { ...overview.data, subscriptions: [] } }, usage: { ...usage, data: { ...usage.data, trend: [], models: [] } } })
  expect(view.getAllByText('No data in this period')).toHaveLength(2)
  expect(view.getByText('No active subscriptions')).toBeTruthy()
  const icon = render(<UsageIcon {...{ size: 20 } as Parameters<typeof UsageIcon>[0]} />)
  expect(icon.container.querySelector('svg')?.getAttribute('width')).toBe('20')
  for (const copy of Object.values(dictionaries)) expect(Object.keys(copy)).toEqual(Object.keys(en))
})
it('shows only safe account binding, public endpoint and masked key metadata', () => {
  if (overview.status !== 'ready') throw new Error('Synthetic overview must be ready')
  const view = mount({ status: 'ready', usage, overview: { ...overview, data: { ...overview.data, keys: [
    { id: brandString<GatewayKeyId>('synthetic-one'), alias: 'Synthetic managed key', maskedKey: 'sk-***1234', status: 'active' },
    { id: brandString<GatewayKeyId>('synthetic-two'), alias: null, maskedKey: 'sk-***5678', status: 'disabled' },
  ] } } })
  expect(view.getByText('synthetic-org')).toBeTruthy()
  expect(view.getByText('synthetic-user')).toBeTruthy()
  expect(view.getByText('https://models.example.com/v1')).toBeTruthy()
  expect(view.getByText('Synthetic managed key')).toBeTruthy()
  expect(view.getByText('Unnamed key')).toBeTruthy()
  expect(view.getByText('sk-***1234')).toBeTruthy()
  expect(view.queryByRole('button', { name: /reveal/i })).toBeNull()
  expect(view.container.textContent).not.toMatch(/synthetic-secret|token|http:\/\/10\./)
})
