// @vitest-environment jsdom
/** Editor presentation decisions, keyboard saves, and physical viewport ownership. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { OfficeBody, type OfficeBodyProps } from '../src/client/Body.tsx'
import type { OfficeEntryState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const tabId = 'office-body' as TabId

function state(patch: Partial<OfficeEntryState> = {}): OfficeEntryState {
  return { document: { path: '/workspace/report.docx', phase: 'ready', dirty: false, saving: false, error: undefined },
    canEdit: true, busy: false, lossCount: 0, trackChanges: true, prompt: undefined, error: undefined, ...patch }
}

function setup(entry: OfficeEntryState | undefined = state(), available = true) {
  const detach = vi.fn()
  const mount = vi.fn<OfficeBodyProps['mount']>(() => detach)
  const save = vi.fn<OfficeBodyProps['save']>()
  const reload = vi.fn<OfficeBodyProps['reload']>()
  const command = vi.fn<OfficeBodyProps['command']>()
  const choose = vi.fn<OfficeBodyProps['choose']>()
  const tracking = vi.fn<OfficeBodyProps['tracking']>()
  const acceptLoss = vi.fn<OfficeBodyProps['acceptLoss']>()
  const signal = new AbortController().signal
  const props = { t: makeTranslate(en), mount, save, reload, command, choose, tracking, acceptLoss,
    useOffice: select => select({ [tabId]: entry }),
    useTabInfo: () => ({ tab: { id: tabId, title: 'report.docx', contentId: 'file', signal } }),
    useResource: () => ({ status: available ? 'ready' : 'none' }),
  } as OfficeBodyProps
  const view = render(<OfficeBody {...props} />)
  return { view, props, mount, detach, save, reload, command, choose, tracking, acceptLoss, signal }
}

it('mounts a unique viewport and releases the attachment when its body disappears', () => {
  const h = setup()
  const viewportId = h.mount.mock.calls[0]?.[0].viewportId
  if (viewportId === undefined) throw new Error('Editor viewport was not attached')
  expect(h.mount).toHaveBeenCalledExactlyOnceWith({ tabId, address: 'file', signal: h.signal, viewportId })
  expect(document.getElementById(viewportId)).toBeTruthy()
  expect(screen.getByRole('status').textContent).toContain(en.saved)
  h.view.unmount()
  expect(h.detach).toHaveBeenCalledTimes(1)
})

it('routes formatting, save, reload, and tracking through the owning tab', () => {
  const h = setup()
  const tools = within(screen.getByRole('toolbar'))
  for (const action of ['undo', 'redo', 'bold', 'italic', 'underline'] as const) {
    fireEvent.click(tools.getByRole('button', { name: en[action] }))
    expect(h.command).toHaveBeenLastCalledWith(tabId, action)
  }
  fireEvent.click(tools.getByRole('button', { name: en.save }))
  fireEvent.click(tools.getByRole('button', { name: en.reload }))
  fireEvent.click(tools.getByRole('checkbox', { name: en.tracking }))
  expect(h.save).toHaveBeenCalledExactlyOnceWith(tabId)
  expect(h.reload).toHaveBeenCalledExactlyOnceWith(tabId)
  expect(h.tracking).toHaveBeenCalledExactlyOnceWith(tabId, false)
})

it('captures only the unmodified platform Save shortcut inside this editor', () => {
  const h = setup()
  const editor = screen.getByRole('region', { name: en['type.label'] })
  for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) {
    expect(fireEvent.keyDown(editor, { key: 'S', ...modifiers })).toBe(false)
  }
  for (const modifiers of [{}, { ctrlKey: true, altKey: true }, { metaKey: true, shiftKey: true }]) {
    expect(fireEvent.keyDown(editor, { key: 's', ...modifiers })).toBe(true)
  }
  fireEvent.keyDown(editor, { key: 'a', ctrlKey: true })
  expect(h.save.mock.calls).toEqual([[tabId], [tabId]])
})

it('keeps an unavailable resource unattached and displays its localized refusal', () => {
  const h = setup(undefined, false)
  expect(h.mount).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe(en.unavailable)
  expect(screen.queryByLabelText(en.loading)).toBeNull()
})

it.each(['loading', 'busy', 'saving', 'readonly'] as const)('prevents editing while %s', (condition) => {
  const entry = state()
  setup(state({ busy: condition === 'busy', canEdit: condition !== 'readonly',
    document: { ...entry.document, phase: condition === 'loading' ? 'loading' : 'ready', saving: condition === 'saving' } }))
  const tools = within(screen.getByRole('toolbar'))
  expect(tools.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  if (condition === 'readonly') expect(screen.getByRole('status').textContent).toContain(en.readonly)
  if (condition === 'saving') expect(screen.getByRole('status').textContent).toContain(en.saving)
  if (condition === 'loading' || condition === 'busy') expect(screen.getByLabelText(en.loading)).toBeTruthy()
})

it('shows dirty state and conversion counts, and offers explicit acceptance and error retry', () => {
  const initial = state()
  const h = setup(state({ document: { ...initial.document, dirty: true }, lossCount: 3, error: 'conflict' }))
  expect(screen.getByRole('status').textContent).toContain(en.unsaved)
  expect(screen.getByText(en['error.conflict'])).toBeTruthy()
  expect(screen.getByText(h.props.t('loss.body', { count: 3 }))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  fireEvent.click(screen.getByRole('button', { name: en['loss.accept'] }))
  expect(h.reload).toHaveBeenCalledExactlyOnceWith(tabId)
  expect(h.acceptLoss).toHaveBeenCalledExactlyOnceWith(tabId)
})

it.each(['close', 'reload'] as const)('offers save, discard, cancel and Escape for a %s decision', (prompt) => {
  const h = setup(state({ prompt }))
  const dialog = within(screen.getByRole('dialog', { name: prompt === 'reload' ? en.reload : en['close.title'] }))
  for (const choice of ['save', 'discard', 'cancel'] as const) {
    for (const button of dialog.getAllByRole('button', { name: en[choice] })) fireEvent.click(button)
    expect(h.choose).toHaveBeenLastCalledWith(tabId, choice)
  }
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(h.choose).toHaveBeenLastCalledWith(tabId, 'cancel')
})
