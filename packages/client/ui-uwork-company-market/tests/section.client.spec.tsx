// @vitest-environment jsdom
/** Catalog rows and actions render through localized props, including retained-result failures. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CompanyMarketSection, type CompanyMarketProps } from '../src/client/Section.tsx'
import { en } from '../src/client/locales.ts'
import type { MarketState } from '../src/client/store.ts'

const value = { source: 'https://market.example', items: [{ slug: 'weather', title: 'Weather', summary: 'Forecasts', version: '1.0.0' }], total: 3, page: 1, nextPage: 2 }
afterEach(cleanup)

function setup(state: MarketState) {
  const load = vi.fn()
  const start = vi.fn()
  const useMarket: CompanyMarketProps['useMarket'] = selector => selector(state)
  const props = { t: makeTranslate(en), useMarket, load, start } as CompanyMarketProps
  const view = render(<CompanyMarketSection {...props} />)
  return { ...view, load, start, props }
}

it('starts once and displays source, skill metadata, pagination and search actions', () => {
  const h = setup({ status: 'ready', value, text: 'old', page: 1 })
  expect(h.start).toHaveBeenCalledTimes(1)
  expect(h.getByText('Weather')).toBeTruthy()
  expect(h.getByText('Forecasts')).toBeTruthy()
  expect(h.getByText('Version 1.0.0')).toBeTruthy()
  expect(h.getByText('Source: https://market.example')).toBeTruthy()
  fireEvent.change(h.getByRole('textbox'), { target: { value: 'new search' } })
  fireEvent.submit(h.getByRole('button', { name: 'Search' }).closest('form')!)
  expect(h.load).toHaveBeenLastCalledWith('new search', 0)
  fireEvent.click(h.getByRole('button', { name: 'Previous' }))
  expect(h.load).toHaveBeenLastCalledWith('old', 0)
  fireEvent.click(h.getByRole('button', { name: 'Next' }))
  expect(h.load).toHaveBeenLastCalledWith('old', 2)
  fireEvent.click(h.getByRole('button', { name: 'Refresh' }))
  expect(h.load).toHaveBeenLastCalledWith('old', 1)
})

it('shows an accessible initial loading skeleton and an empty result', () => {
  const h = setup({ status: 'loading', value: null, text: '', page: 0 })
  expect(h.getByRole('status', { name: 'Loading company skills' })).toBeTruthy()
  const empty: MarketState = { status: 'ready', text: '', page: 0, value: { ...value, items: [], total: 0, page: 0, nextPage: null } }
  h.rerender(<CompanyMarketSection {...h.props} useMarket={selector => selector(empty)} />)
  expect(h.getByText('No skills found')).toBeTruthy()
  expect((h.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
  expect((h.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
})

it('keeps prior rows after failure, labels their age and prevents paging a failed query', () => {
  const h = setup({ status: 'error', value, text: 'new failed query', page: 0, failure: 'rate' })
  expect(h.getByRole('alert').textContent).toContain('Too many requests')
  expect(h.getByText('Showing previous results')).toBeTruthy()
  expect(h.getByText('Weather')).toBeTruthy()
  expect((h.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  expect((h.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(h.getByRole('button', { name: 'Retry' }))
  expect(h.load).toHaveBeenCalledWith('new failed query', 0)
})
