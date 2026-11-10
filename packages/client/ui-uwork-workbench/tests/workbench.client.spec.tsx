// @vitest-environment jsdom
/** Product presentation leaves the native tab engine and retained bodies in control. */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DockController, DockLayout, type DockLabels, type TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { WorkbenchFrame } from '../src/client/WorkbenchFrame.tsx'

const contexts: Context[] = []
afterEach(async () => { cleanup(); await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Declaration-only owner: these registry lifecycle tests do not mount a Session view. */
function FrameOwner(_props: PropsRenderSlots<'sidebar.right.frame'>) { return null }

it('keeps the Host entry inert', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin({ apply: hostApply }).await()
})

it.each([true, false])('attaches only to a declared frame before=%s and withdraws with its plugin lifetime', async (before) => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.slots
  const declare = () => ctx.effect(() => slots.register({ name: 'root', inject: () => ({}), children: {
    'sidebar.right.frame': { kind: 'hoc', scope: 'session' },
  } }, FrameOwner))
  const disposeOwner = before ? declare() : undefined
  const feature = ctx.plugin({ inject, apply })
  await feature.await()
  if (!before) { declare(); await Promise.resolve() }
  expect(slots.entries('sidebar.right.frame')).toHaveLength(1)
  if (disposeOwner !== undefined) {
    await disposeOwner()
    expect(slots.entries('sidebar.right.frame')).toHaveLength(0)
    declare(); await Promise.resolve()
    expect(slots.entries('sidebar.right.frame')).toHaveLength(1)
  }
  await feature.dispose()
  expect(slots.entries('sidebar.right.frame')).toHaveLength(0)
})

function Probe({ mounted }: { mounted: () => void }) {
  useEffect(mounted, [mounted])
  return <input aria-label="Retained document" defaultValue="Draft" />
}
it('preserves the same focused child across active, collapsed and fullscreen presentations', () => {
  const mounted = vi.fn()
  const view = render(<WorkbenchFrame active expanded fullscreen={false}><Probe mounted={mounted} /></WorkbenchFrame>)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'Unsent work' } })
  input.focus()
  view.rerender(<WorkbenchFrame active={false} expanded={false} fullscreen><Probe mounted={mounted} /></WorkbenchFrame>)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveProperty('value', 'Unsent work')
  expect(document.activeElement).toBe(input)
  expect(mounted).toHaveBeenCalledOnce()
})

const labels: DockLabels = {
  emptyPane: 'Empty', splitPane: 'Split', splitPaneDisabled: 'Pane limit', splitPaneNarrow: 'Too narrow',
  closeTab: 'Close', addTab: 'Add', dockFloat: 'Dock', closeFloat: 'Close pane',
  dropZone: { center: 'Move', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' },
}
function TabBody({ tab }: { tab: TabRecord }) {
  const [draft, setDraft] = useState(tab.title)
  return <input aria-label={tab.title} value={draft} onChange={(event) => { setDraft(event.target.value) }} />
}
const renderTab = (tab: TabRecord) => <TabBody tab={tab} />
function NativeWorkbench({ controller }: { controller: DockController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot).state
  return <WorkbenchFrame active expanded={state.expanded} fullscreen={state.mode === 'fullscreen'}>
    <DockLayout state={state} canSplit intents={controller} labels={labels} renderTab={renderTab} keepMounted={() => true} />
  </WorkbenchFrame>
}
it('keeps native file, browser, terminal and document tabs through focus, split, float and close operations', () => {
  const controller = new DockController()
  controller.setExpanded(true)
  const tabs = ['File', 'Browser', 'Terminal', 'Document'].map(kind => controller.openContent({ kind, contentId: kind, title: kind }))
  render(<NativeWorkbench controller={controller} />)
  act(() => { controller.focusTab(tabs[0]!) })
  const input = screen.getByRole('textbox', { name: 'File' })
  fireEvent.change(input, { target: { value: 'Retained file selection' } })
  act(() => { controller.focusTab(tabs[1]!); controller.focusTab(tabs[0]!); controller.splitPane() })
  expect(screen.getByRole('textbox', { name: 'File' })).toBe(input)
  expect(input).toHaveProperty('value', 'Retained file selection')
  act(() => { controller.floatTab(tabs[0]!) })
  expect(screen.getByRole('textbox', { name: 'File' })).toBe(input)
  act(() => { controller.closeTab(tabs[2]!) })
  expect(document.querySelector(`[data-dockkit-content="${tabs[2]!}"]`)).toBeNull()
  expect(screen.getByRole('textbox', { name: 'File' })).toBe(input)
})
