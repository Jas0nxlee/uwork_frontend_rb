// @vitest-environment jsdom
/** Catalog rows and actions render through localized props, including retained-result failures. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CompanyMarketSection, type CompanyMarketProps } from '../src/client/Section.tsx'
import { en } from '../src/client/locales.ts'
import type { InstallationState } from '../src/client/installations.ts'
import type { MarketState } from '../src/client/store.ts'

const value = { source: 'https://market.example', items: [{ slug: 'weather', title: 'Weather', summary: 'Forecasts', version: '1.0.0' }], total: 3, page: 1, nextPage: 2 }
afterEach(cleanup)

function setup(
  state: MarketState,
  installation: InstallationState = { value: { available: false, skills: [] }, loading: false, pending: null, failure: null },
) {
  const load = vi.fn()
  const start = vi.fn()
  const useMarket: CompanyMarketProps['useMarket'] = selector => selector(state)
  const props = {
    t: makeTranslate(en), useMarket, useInstallations: selector => selector(installation), load, start,
    refreshInstallations: vi.fn(), installSkill: vi.fn(), setSkillEnabled: vi.fn(), uninstallSkill: vi.fn(),
  } as CompanyMarketProps
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


it('installs exact versions and manages installed rows independently from the current catalog', () => {
  const installation: InstallationState = { value: { available: true, skills: [{ slug: 'retired', version: '1', fingerprint: 'sha256:test', enabled: true, fileCount: 1 }] }, loading: false, pending: null, failure: null }
  const h = setup({ status: 'ready', value, text: '', page: 1 }, installation)
  fireEvent.click(h.getByRole('button', { name: 'Install' }))
  expect(h.props.installSkill).toHaveBeenCalledWith('weather', '1.0.0')
  fireEvent.click(h.getByRole('button', { name: 'Disable' }))
  expect(h.props.setSkillEnabled).toHaveBeenCalledWith('retired', false)
  fireEvent.click(h.getByRole('button', { name: 'Uninstall' }))
  expect(h.props.uninstallSkill).toHaveBeenCalledWith('retired')
  expect(h.getByText('retired')).toBeTruthy()
})

it('retains installed rows but blocks management after a failed state read', () => {
  const installation: InstallationState = { value: { available: true, skills: [{ slug: 'weather', version: '1.0.0', fingerprint: 'sha256:test', enabled: false, fileCount: 1 }] }, loading: false, pending: null, failure: 'installationRead' }
  const h = setup({ status: 'ready', value, text: '', page: 1 }, installation)
  expect(h.getByRole('alert').textContent).toContain('Could not read installed skills')
  expect((h.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true)
  expect((h.getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement).disabled).toBe(true)
})


it('shows installation loading and pending feedback while preventing conflicting actions', () => {
  const h = setup({ status: 'ready', value, text: '', page: 1 }, { value: null, loading: true, pending: null, failure: null })
  expect(h.getByRole('status').textContent).toContain('Loading installed skills')
  const installation: InstallationState = { value: { available: true, skills: [{ slug: 'weather', version: '0.1.0', fingerprint: 'sha256:test', enabled: true, fileCount: 1 }] }, loading: false, pending: 'weather', failure: null }
  h.rerender(<CompanyMarketSection {...h.props} useInstallations={selector => selector(installation)} />)
  expect(h.getAllByRole('status')).toHaveLength(2)
  expect((h.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(true)
  expect((h.getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement).disabled).toBe(true)
})


it('shows an empty installed list and permits an update only when versions differ', () => {
  const h = setup(
    { status: 'ready', value, text: '', page: 1 },
    { value: { available: true, skills: [] }, loading: false, pending: null, failure: null },
  )
  expect(h.getByText('No company skills installed')).toBeTruthy()
  const version = { slug: 'weather', version: '0.1', fingerprint: 'sha256:test', enabled: true, fileCount: 1 }
  h.rerender(<CompanyMarketSection {...h.props} useInstallations={selector => selector({
    value: { available: true, skills: [version] }, loading: false, pending: null, failure: null,
  })} />)
  fireEvent.click(h.getByRole('button', { name: 'Update' }))
  expect(h.props.installSkill).toHaveBeenCalledWith('weather', '1.0.0')
  h.rerender(<CompanyMarketSection {...h.props} useInstallations={selector => selector({
    value: { available: true, skills: [{ ...version, version: '1.0.0' }] }, loading: false, pending: null, failure: null,
  })} />)
  expect((h.getByRole('button', { name: 'Up to date' }) as HTMLButtonElement).disabled).toBe(true)
})
