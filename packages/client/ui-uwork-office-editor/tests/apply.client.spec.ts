// @vitest-environment jsdom
/** Optional editor registrations, Session ownership, Remote refusals, and unload. */
import { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SidebarRightCloseGuard, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TestRemote, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OfficeController } from '../src/client/controller.ts'
import type { OfficeFace } from '../src/client/Body.tsx'
import { apply, inject } from '../src/client/index.ts'

type Options = ConstructorParameters<typeof OfficeController>[0]
const fake = vi.hoisted(() => ({
  options: [] as Options[], mount: vi.fn(() => () => {}), save: vi.fn(async () => {}), reload: vi.fn(async () => {}),
  acceptLoss: vi.fn(async () => {}), command: vi.fn(), tracking: vi.fn(), choose: vi.fn(),
  prepareClose: vi.fn(async () => true), dispose: vi.fn(async () => {}),
}))
vi.mock('../src/client/controller.ts', () => ({ OfficeController: class {
  constructor(options: Options) { fake.options.push(options) }
  getSnapshot = () => ({})
  subscribe = () => () => {}
  mount = fake.mount
  save = fake.save
  reload = fake.reload
  acceptLoss = fake.acceptLoss
  command = fake.command
  tracking = fake.tracking
  choose = fake.choose
  prepareClose = fake.prepareClose
  dispose = fake.dispose
} }))

const contexts: Context[] = []
const session = SessionId('office-session')
const tab: TabRecord = { id: 'office-tab' as TabId, title: 'report.docx', kind: 'uwork-office', contentId: 'file' }
const signal = () => new AbortController().signal
beforeEach(() => { vi.clearAllMocks(); fake.options.splice(0); fake.dispose.mockResolvedValue() })
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  const rows: { inject: (id: SessionId) => OfficeFace }[] = []
  const definitions: SidebarRightTabDefinition[] = []
  const guards = new Map<string, SidebarRightCloseGuard>()
  const dictionaries = new Map<string, unknown>()
  const released = vi.fn()
  const slots = { inject: (_name: string, register: () => () => void) => register(),
    register: (row: { inject: (id: SessionId) => OfficeFace }) => { rows.push(row); return released } }
  ctx.provide('slots', slots as never)
  ctx.provide('locale', { register: (namespace: string, dictionary: unknown) => {
    dictionaries.set(namespace, dictionary); return () => { dictionaries.delete(namespace) }
  } } as never)
  ctx.provide('sidebarRightTabs', { register: (definition: SidebarRightTabDefinition) => {
    definitions.push(definition); return released
  } } as never)
  ctx.provide('sidebarRight', { registerCloseGuard: (kind: string, guard: SidebarRightCloseGuard) => {
    guards.set(kind, guard); return () => { guards.delete(kind) }
  } } as never)
  const files = {
    read: vi.fn<Context['remote']['uworkOfficeStorage']['read']>(async (_owner, path) => ({ ok: true,
      value: { absolutePath: path, version: FsVersion('read'), bytes: 1, data: new Uint8Array([1]) } })),
    save: vi.fn<Context['remote']['uworkOfficeStorage']['save']>(async (_owner, request) => ({ ok: true,
      value: { absolutePath: request.path, version: FsVersion('saved'), bytes: 1, operation: 'update' } })),
    capabilities: vi.fn<Context['remote']['uworkOfficeStorage']['capabilities']>(async () => ({ ok: true,
      value: { maxDocumentBytes: 100, writePolicy: 'workspace-write' } })),
  }
  new TestRemote(ctx, { uworkOfficeStorage: files })
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  const row = rows[0]
  const definition = definitions[0]
  const guard = guards.get('uwork-office')
  if (row === undefined || definition === undefined || guard === undefined) throw new Error('Office registration did not activate')
  return { ctx, fiber, face: row.inject, definition, guard, guards, dictionaries, released, files }
}
function firstOptions(): Options {
  const options = fake.options[0]
  if (options === undefined) throw new Error('Office controller was not created')
  return options
}

it('registers a DOCX resource type and one controller per Session, then withdraws owned effects', async () => {
  const h = await boot()
  expect(h.definition.patterns).toEqual(['*.docx'])
  expect(h.definition.canOpen?.('dsh-resource://file/session/office-session/report.docx')).toBe(true)
  expect(h.definition.canOpen?.('https://example.com/report.docx')).toBe(false)
  expect(h.definition.title('dsh-resource://file/session/office-session/folder/report.docx')).toBe('report.docx')
  expect(h.definition.title('invalid')).toBe('invalid')
  expect(await h.guard.prepare(session, tab, signal())).toBe(true)
  const face = h.face(session)
  h.face(session)
  h.face(SessionId('another-session'))
  expect(fake.options).toHaveLength(2)
  expect(await h.guard.prepare(session, tab, signal())).toBe(true)
  expect(fake.prepareClose).toHaveBeenCalledWith(tab.id, expect.any(AbortSignal))
  const cancel = new AbortController()
  face.mount({ tabId: tab.id, address: 'file', viewportId: 'view', signal: cancel.signal })
  face.save(tab.id); face.reload(tab.id); face.acceptLoss(tab.id)
  face.command(tab.id, 'bold'); face.tracking(tab.id, false); face.choose(tab.id, 'cancel')
  expect(fake.save).toHaveBeenCalledWith(tab.id)
  expect(fake.reload).toHaveBeenCalledWith(tab.id)
  expect(fake.acceptLoss).toHaveBeenCalledWith(tab.id)
  expect(fake.command).toHaveBeenCalledWith(tab.id, 'bold')
  expect(fake.tracking).toHaveBeenCalledWith(tab.id, false)
  expect(fake.choose).toHaveBeenCalledWith(tab.id, 'cancel')
  expect(h.dictionaries.has('uworkOfficeEditor')).toBe(true)
  await h.fiber.dispose()
  expect(fake.dispose).toHaveBeenCalledTimes(2)
  expect(h.dictionaries.size).toBe(0)
  expect(h.guards.size).toBe(0)
  expect(h.released).toHaveBeenCalledTimes(2)
})

it('binds file calls to their owning Session and respects the current write policy', async () => {
  const h = await boot()
  h.face(session)
  const options = firstOptions()
  const files = options.files(session)
  expect(await files.read('report.docx', signal())).toMatchObject({ version: 'read' })
  expect(await files.save({ path: 'report.docx', contentBase64: 'AQ==', expected: { kind: 'createIfAbsent' } }, signal()))
    .toMatchObject({ version: 'saved' })
  expect(h.files.read).toHaveBeenCalledWith(session, 'report.docx', expect.any(AbortSignal))
  expect(await options.canWrite(session, signal())).toBe(true)
  h.files.capabilities.mockResolvedValueOnce({ ok: true, value: { maxDocumentBytes: 100, writePolicy: 'read-only' } })
  expect(await options.canWrite(session, signal())).toBe(false)
  expect(options.word.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
})

it.each([
  ['FS_STALE_VERSION', 'conflict'], ['FS_NOT_OBSERVED', 'conflict'], ['FS_PERMISSION_DENIED', 'denied'],
  ['FS_SANDBOX_DENIED', 'denied'], ['FS_TOO_LARGE', 'too-large'], ['busy', 'busy'], ['unsupported-format', 'failed'],
] as const)('presents %s without returning backend diagnostics', async (reason, presented) => {
  const h = await boot()
  h.face(session)
  const error = new RemoteError('office-file/failed', 'private backend detail', { reason })
  h.files.read.mockResolvedValueOnce({ ok: false, error })
  await expect(firstOptions().files(session).read('report.docx', signal())).rejects.toMatchObject({ reason: presented, cause: error })
})

it('classifies cancellation and other Remote refusals on save and policy lookup', async () => {
  const h = await boot()
  h.face(session)
  const cancelled = new RemoteError('gateway/cancelled', 'cancelled', {})
  h.files.save.mockResolvedValueOnce({ ok: false, error: cancelled })
  await expect(firstOptions().files(session).save({ path: 'report.docx', contentBase64: '', expected: { kind: 'createIfAbsent' } }, signal()))
    .rejects.toMatchObject({ reason: 'cancelled' })
  h.files.capabilities.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'private', {}) })
  await expect(firstOptions().canWrite(session, signal())).rejects.toMatchObject({ reason: 'failed' })
})
