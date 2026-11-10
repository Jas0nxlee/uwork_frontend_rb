// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAuthorizationPage } from '../src/client/NativeAuthorizationPage.tsx'
import type { NativeAuthorizationState, NativeAuthorizationAttemptId } from '@deepseek-ai/dsh-native-authorization/types'
import type { NativeAuthorizationApi } from '../src/native-authorization-api.ts'
afterEach(() => { cleanup(); vi.useRealTimers() })
const id = 'owned' as NativeAuthorizationAttemptId
const initial: NativeAuthorizationState = { status: 'signed-out', choices: [{ id: 'first', label: 'First organization' }, { id: 'second', label: 'A long organization name for wrapping and selection' }], selectedChoiceId: 'first' }
function setup(locale = 'en') {
  const pending: NativeAuthorizationState = { ...initial, status: 'pending', attempt: { id, expiresAt: 5000 } }
  const api: NativeAuthorizationApi = {
    state: vi.fn(async () => initial), start: vi.fn(async () => pending), poll: vi.fn(async () => pending),
    cancel: vi.fn(async () => initial),
  }
  render(<NativeAuthorizationPage api={api} initial={initial} locale={locale} />)
  return { api, pending }
}
it.each(['en', 'zh-CN'])('renders %s choices and safe pending/cancelled status', async (locale) => {
  const { api } = setup(locale)
  const selection = screen.getByRole('combobox')
  fireEvent.change(selection, { target: { value: 'second' } })
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  expect(api.start).toHaveBeenCalledWith('second', { x: 0, y: 0, width: 0, height: 0 })
  expect(selection).toHaveProperty('disabled', true)
  expect(screen.getByRole('status').textContent).toBe(locale === 'en' ? 'Scan the QR code to continue' : '请扫码继续登录')
  await expect(document.body.textContent.replace(/\u00a0/g, '').trim()).toMatchFileSnapshot(`./expected/native-authorization/${locale}-pending.expected.txt`)
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  expect(api.cancel).toHaveBeenCalledWith(id)
  expect(selection).toHaveProperty('disabled', false)
})
it('shows expired attempts and allows a fresh attempt without exposing navigation', async () => {
  vi.useFakeTimers()
  const { api } = setup()
  vi.mocked(api.poll).mockResolvedValue({ ...initial, error: 'expired' })
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(screen.getByRole('alert').textContent).toContain('expired')
  expect(screen.getByRole('button').textContent).toBe('Try again')
  expect(document.body.innerHTML).not.toContain('https://')
})
it('reports failures without displaying provider diagnostics and releases polling on unmount', async () => {
  const { api } = setup()
  vi.mocked(api.start).mockRejectedValue(new Error('private diagnostic'))
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  expect(screen.getByRole('alert').textContent).toBe('Sign-in is unavailable. Please try again.')
  expect(document.body.textContent).not.toContain('private diagnostic')
})

it('recovers a withdrawn document-load failure to a retryable entry', async () => {
  vi.useFakeTimers()
  const { api } = setup()
  vi.mocked(api.poll).mockRejectedValue(new Error('attempt withdrawn'))
  vi.mocked(api.state).mockResolvedValue(initial)
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(screen.getByRole('button').textContent).toBe('Try again')
  expect(screen.getByRole('combobox')).toHaveProperty('disabled', false)
  expect(document.body.textContent).not.toContain('attempt withdrawn')
})
