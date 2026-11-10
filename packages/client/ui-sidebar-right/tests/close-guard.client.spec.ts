import { expect, it, vi } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { controllerHarness as harness, SESSION } from './controller-harness.client.ts'

function opened() {
  const h = harness()
  h.publish()
  h.controller.openResource('dsh-resource://file/session/s-test/document.docx')
  return { ...h, tab: h.tabOf('document.docx') }
}

function decision() {
  let resolve!: (allow: boolean) => void
  const promise = new Promise<boolean>((accept) => { resolve = accept })
  return { promise, resolve }
}

it.each(['close', 'replace'])('waits for permission before %s and allows cancellation', async (operation) => {
  const h = opened()
  const answer = decision()
  const cleanup = vi.fn()
  h.controller.registerCloseHandler('text', cleanup)
  h.controller.registerCloseGuard('text', { prepare: () => answer.promise, failed: vi.fn() })
  if (operation === 'close') h.controller.closeIn(SESSION, h.tab)
  else h.controller.openResource('dsh-resource://file/session/s-test/next.docx', { replaceTab: h.tab, revealIfOpened: false })
  expect(h.layout().tabs[h.tab]).toBeDefined()
  expect(cleanup).not.toHaveBeenCalled()
  answer.resolve(false)
  await h.controller.requestCloseIn(SESSION, h.tab)
  expect(h.layout().tabs[h.tab]).toBeDefined()
  expect(cleanup).not.toHaveBeenCalled()
})

it('deduplicates a pending save and closes only after approval', async () => {
  const h = opened()
  const answer = decision()
  const prepare = vi.fn(() => answer.promise)
  h.controller.registerCloseGuard('text', { prepare, failed: vi.fn() })
  const first = h.controller.requestCloseIn(SESSION, h.tab)
  const second = h.controller.requestCloseIn(SESSION, h.tab)
  expect(first).toBe(second)
  await Promise.resolve()
  expect(prepare).toHaveBeenCalledTimes(1)
  answer.resolve(true)
  expect(await first).toBe(true)
  expect(h.layout().tabs[h.tab]).toBeUndefined()
})

it('withdraws an unloaded guard and ignores its late approval', async () => {
  const h = opened()
  const answer = decision()
  const failed = vi.fn()
  const release = h.controller.registerCloseGuard('text', { prepare: () => answer.promise, failed })
  const pending = h.controller.requestCloseIn(SESSION, h.tab)
  release()
  expect(await pending).toBe(false)
  answer.resolve(true)
  await Promise.resolve()
  expect(h.layout().tabs[h.tab]).toBeDefined()
  expect(failed).not.toHaveBeenCalled()
})

it('retains the tab and reports save failure to the editor owner', async () => {
  const h = opened()
  const failure = new Error('save failed')
  const failed = vi.fn()
  h.controller.registerCloseGuard('text', { prepare: async () => { throw failure }, failed })
  expect(await h.controller.requestCloseIn(SESSION, h.tab)).toBe(false)
  expect(failed).toHaveBeenCalledWith(failure)
  expect(h.layout().tabs[h.tab]).toBeDefined()
})

it('does not commit into a released session adoption', async () => {
  const h = opened()
  const answer = decision()
  h.controller.registerCloseGuard('text', { prepare: () => answer.promise, failed: vi.fn() })
  const pending = h.controller.requestCloseIn(SESSION, h.tab)
  h.unadopt()
  answer.resolve(true)
  expect(await pending).toBe(false)
  expect(h.layout().tabs[h.tab]).toBeDefined()
})


it('replaces the tab only after its save decision has settled', async () => {
  const h = opened()
  const answer = decision()
  h.controller.registerCloseGuard('text', { prepare: () => answer.promise, failed: vi.fn() })
  h.controller.openResource('dsh-resource://file/session/s-test/next.docx', { replaceTab: h.tab, revealIfOpened: false })
  const pending = h.controller.requestCloseIn(SESSION, h.tab)
  expect(h.titles()).not.toContain('next.docx')
  answer.resolve(true)
  expect(await pending).toBe(true)
  expect(h.layout().tabs[h.tab]).toBeUndefined()
  expect(h.titles()).toContain('next.docx')
})

it('withdraws permission when undo ends an occurrence and preserves the redo occurrence', async () => {
  const h = opened()
  const answer = decision()
  h.controller.registerCloseGuard('text', { prepare: () => answer.promise, failed: vi.fn() })
  const pending = h.controller.requestCloseIn(SESSION, h.tab)
  h.controller._undo()
  expect(await pending).toBe(false)
  h.controller._redo()
  answer.resolve(true)
  await Promise.resolve()
  expect(h.layout().tabs[h.tab]).toBeDefined()
})


it('refuses absent surfaces and tabs and retains the sole docked guide', async () => {
  const h = harness()
  expect(await h.controller.requestCloseIn(SESSION, 'missing' as TabId)).toBe(false)
  h.instance.actions.open(SESSION)
  h.publish()
  h.controller.openTab('guide')
  const guide = Object.values(h.layout().tabs)[0]!
  expect(await h.controller.requestCloseIn(SESSION, guide.id)).toBe(false)
  expect(await h.controller.requestCloseIn(SESSION, 'missing' as TabId)).toBe(false)
})

it('keeps registration ownership and withdraws only its own decisions', async () => {
  const h = opened()
  h.controller.openTab('guide')
  const text = decision(), guide = decision()
  const first = { prepare: () => text.promise, failed: vi.fn() }
  const release = h.controller.registerCloseGuard('text', first)
  expect(() => h.controller.registerCloseGuard('text', first)).toThrow('already registered')
  const guideTab = Object.values(h.layout().tabs).find(tab => tab.kind === 'guide')!
  const releaseGuide = h.controller.registerCloseGuard('guide', { prepare: () => guide.promise, failed: vi.fn() })
  const textClose = h.controller.requestCloseIn(SESSION, h.tab)
  const guideClose = h.controller.requestCloseIn(SESSION, guideTab.id)
  release()
  expect(await textClose).toBe(false)
  guide.resolve(false)
  expect(await guideClose).toBe(false)
  const replacement = vi.fn(async () => false)
  const releaseNew = h.controller.registerCloseGuard('text', { prepare: replacement, failed: vi.fn() })
  release()
  expect(await h.controller.requestCloseIn(SESSION, h.tab)).toBe(false)
  expect(replacement).toHaveBeenCalledOnce()
  releaseNew(); releaseGuide()
})

it('does not report cleanup failure to an owner that withdrew during cleanup', async () => {
  const h = opened()
  const failed = vi.fn()
  const release = h.controller.registerCloseGuard('text', { prepare: async () => true, failed })
  h.controller.registerCloseHandler('text', () => { release(); throw new Error('owner unloaded during cleanup') })
  expect(await h.controller.requestCloseIn(SESSION, h.tab)).toBe(false)
  expect(failed).not.toHaveBeenCalled()
  expect(h.layout().tabs[h.tab]).toBeDefined()
})
