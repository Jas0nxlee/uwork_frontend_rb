// @vitest-environment jsdom
/** Retained editor lifetimes and explicit unsaved-edit decisions. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { createOfficeEngineQueue } from '../src/client/engine-queue.ts'
import { OfficeController } from '../src/client/controller.ts'
import type { OfficeDocumentCodec, OfficeDocumentFiles } from '../src/client/document.ts'
import type { WordModel } from '../src/client/word.ts'
import { emptyFindings } from '../src/client/formats/docx/docxPreflight.ts'

const engine = vi.hoisted(() => ({
  create: vi.fn(), destroy: vi.fn(), value: vi.fn(), bold: vi.fn(),
  listener: { contentChange: undefined as (() => void) | undefined },
  accept: vi.fn(),
}))
vi.mock('@hufe921/canvas-editor', () => ({ EditorMode: { READONLY: 'readonly' } }))
vi.mock('../src/client/word-engine.ts', () => ({ createWordEditor: engine.create }))
vi.mock('../src/client/word.ts', () => ({ wordCodec: () => codec, acceptWordLoss: engine.accept }))

function model(loss = false): WordModel {
  const bytes = new ArrayBuffer(0)
  return { snapshot: loss ? undefined : () => ({ value: { version: '1', data: { main: [{ value: 'original' }] }, options: {} } }),
    importBytes: bytes, reviewSource: bytes, preflight: { bytes, findings: emptyFindings(), changes: [] },
    warnings: loss ? [{ kind: 'footnotes', count: 2 }] : [],
    preservation: { paragraphs: [], comments: [], namespaces: [] }, trackChanges: true, acceptedLoss: !loss }
}
const codec: OfficeDocumentCodec<WordModel> = {
  extension: 'docx', parse: vi.fn<OfficeDocumentCodec<WordModel>['parse']>(async () => model()), capture: current => current,
  export: vi.fn<OfficeDocumentCodec<WordModel>['export']>(async current => ({ bytes: new Uint8Array([2]), adopt: current })),
  committed: (current, published, unchanged) => unchanged ? published : current,
}
const controllers: OfficeController[] = []
const tabId = 'office-tab' as TabId
const viewportId = 'office-viewport'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(codec.parse).mockImplementation(async () => model())
  engine.listener.contentChange = undefined
  engine.value.mockReturnValue({ version: '1', data: { main: [{ value: 'edited' }] }, options: {} })
  engine.create.mockImplementation(() => ({ command: {
    getValue: engine.value, executeMode: vi.fn(), executeBold: engine.bold,
    executeUndo: vi.fn(), executeRedo: vi.fn(), executeItalic: vi.fn(), executeUnderline: vi.fn(),
  }, listener: engine.listener, destroy: engine.destroy }))
  vi.stubGlobal('CSS', { escape: (id: string) => id })
  document.body.innerHTML = `<div id="${viewportId}"></div>`
})
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function setup(writable = true) {
  const files: OfficeDocumentFiles = {
    read: vi.fn<OfficeDocumentFiles['read']>(async path => ({ absolutePath: path, version: FsVersion('opened'), bytes: 1, data: new Uint8Array([1]) })),
    save: vi.fn<OfficeDocumentFiles['save']>(async request => ({ absolutePath: request.path, version: FsVersion('saved'), bytes: 1, operation: 'update' as const })),
  }
  const failed = vi.fn()
  const controller = new OfficeController({ engineQueue: createOfficeEngineQueue(), files: () => files, canWrite: async () => writable,
    word: { author: 'Test', now: () => '2026-11-10T00:00:00Z', maxDocumentXmlBytes: 1000, minRetainedTextRatio: 0.8 }, failed })
  controllers.push(controller)
  const abort = new AbortController()
  const mount = () => controller.mount({ tabId, address: fileAddressFor('session', '/workspace', 'report.docx'),
    viewportId, signal: abort.signal })
  const state = () => controller.getSnapshot()[tabId]
  const ready = async () => { mount(); await vi.waitFor(() => { expect(state()?.document.phase).toBe('ready') }) }
  return { controller, files, failed, abort, mount, state, ready }
}

it('retains one editor across physical body remounts and ignores an older detach', async () => {
  const h = setup()
  const detachOld = h.mount()
  await vi.waitFor(() => { expect(engine.create).toHaveBeenCalledTimes(1) })
  const detachCurrent = h.mount()
  detachOld()
  expect(document.getElementById(viewportId)?.childElementCount).toBe(1)
  expect(engine.destroy).not.toHaveBeenCalled()
  detachCurrent()
  expect(document.getElementById(viewportId)?.childElementCount).toBe(0)
  h.mount()
  expect(engine.create).toHaveBeenCalledTimes(1)
})

it('keeps the tab on cancel, then saves the dirty snapshot before approving close', async () => {
  const h = setup()
  await h.ready()
  engine.listener.contentChange?.()
  const first = h.controller.prepareClose(tabId, new AbortController().signal)
  await vi.waitFor(() => { expect(h.state()?.prompt).toBe('close') })
  h.controller.choose(tabId, 'cancel')
  expect(await first).toBe(false)
  expect(h.state()?.document.dirty).toBe(true)
  const second = h.controller.prepareClose(tabId, new AbortController().signal)
  await vi.waitFor(() => { expect(h.state()?.prompt).toBe('close') })
  h.controller.choose(tabId, 'save')
  expect(await second).toBe(true)
  expect(h.files.save).toHaveBeenCalledTimes(1)
  expect(h.state()?.document.dirty).toBe(false)
})

it('withdraws a pending close decision when its caller cancels', async () => {
  const h = setup()
  await h.ready()
  engine.listener.contentChange?.()
  const close = new AbortController()
  const answer = h.controller.prepareClose(tabId, close.signal)
  await vi.waitFor(() => { expect(h.state()?.prompt).toBe('close') })
  close.abort()
  expect(await answer).toBe(false)
  expect(h.state()?.prompt).toBeUndefined()
  expect(h.files.save).not.toHaveBeenCalled()
})

it('allows explicit discard without saving, and enforces readonly editing actions', async () => {
  const h = setup()
  await h.ready()
  h.controller.tracking(tabId, false)
  const close = h.controller.prepareClose(tabId, new AbortController().signal)
  await vi.waitFor(() => { expect(h.state()?.prompt).toBe('close') })
  h.controller.choose(tabId, 'discard')
  expect(await close).toBe(true)
  expect(h.files.save).not.toHaveBeenCalled()
  const readonly = setup(false)
  await readonly.ready()
  readonly.controller.command(tabId, 'bold')
  readonly.controller.tracking(tabId, false)
  await readonly.controller.save(tabId)
  expect(readonly.state()?.document.dirty).toBe(false)
  expect(engine.bold).not.toHaveBeenCalled()
  expect(readonly.files.save).not.toHaveBeenCalled()
})

it('reloads only after an explicit dirty-document decision', async () => {
  const h = setup()
  await h.ready()
  engine.listener.contentChange?.()
  const reload = h.controller.reload(tabId)
  await vi.waitFor(() => { expect(h.state()?.prompt).toBe('reload') })
  h.controller.choose(tabId, 'discard')
  await reload
  expect(h.files.read).toHaveBeenCalledTimes(2)
  expect(engine.destroy).toHaveBeenCalledTimes(1)
  expect(engine.create).toHaveBeenCalledTimes(2)
  expect(h.state()?.document.dirty).toBe(false)
})

it('keeps converted imports blocked until acceptance and clears the warning afterwards', async () => {
  vi.mocked(codec.parse).mockImplementationOnce(async () => model(true))
  engine.accept.mockResolvedValue(model())
  const h = setup()
  await h.ready()
  expect(engine.create).not.toHaveBeenCalled()
  expect(h.state()?.lossCount).toBe(2)
  await h.controller.acceptLoss(tabId)
  expect(engine.create).toHaveBeenCalledTimes(1)
  expect(h.state()?.lossCount).toBe(0)
  expect(h.state()?.document.dirty).toBe(true)
})

it('reports engine construction failure without enabling editing', async () => {
  engine.create.mockImplementationOnce(() => { throw new Error('engine startup') })
  const h = setup()
  await h.ready()
  expect(h.failed).toHaveBeenCalledTimes(1)
  expect(h.state()).toMatchObject({ canEdit: false, error: 'failed' })
})

it('drains an in-flight load before disposing and destroys a retained engine once', async () => {
  const h = setup()
  await h.ready()
  h.abort.abort()
  await vi.waitFor(() => { expect(h.state()).toBeUndefined() })
  await h.controller.dispose()
  expect(engine.destroy).toHaveBeenCalledTimes(1)
  expect(await h.controller.prepareClose(tabId, new AbortController().signal)).toBe(true)
})
