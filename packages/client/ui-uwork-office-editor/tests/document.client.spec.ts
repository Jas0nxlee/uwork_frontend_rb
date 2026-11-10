/** Document publication remains tied to the snapshot captured before asynchronous export. */
import { FsVersion } from '@deepseek-ai/dsh-fs'
import { expect, it, vi } from 'vitest'
import { OfficeDocument, OfficeDocumentError, type OfficeDocumentFiles, type OfficeDocumentCodec } from '../src/client/document.ts'

const source = new Uint8Array([1, 2, 3])
const firstVersion = FsVersion('opened')
const secondVersion = FsVersion('saved')

function setup() {
  const files: OfficeDocumentFiles = {
    read: vi.fn<OfficeDocumentFiles['read']>(async path => ({ absolutePath: path, version: firstVersion, bytes: source.length, data: source })),
    save: vi.fn<OfficeDocumentFiles['save']>(async request => ({ absolutePath: request.path, version: secondVersion,
      bytes: Buffer.from(request.contentBase64, 'base64').length, operation: 'update' })),
  }
  const codec: OfficeDocumentCodec<string> = {
    extension: 'docx',
    parse: vi.fn<OfficeDocumentCodec<string>['parse']>(async bytes => Array.from(bytes).join(',')),
    capture: vi.fn<OfficeDocumentCodec<string>['capture']>((model: string) => model),
    committed: (current, published, unchanged) => unchanged ? published : current,
    export: vi.fn<OfficeDocumentCodec<string>['export']>(async (_model, _baseline, signal) => {
      signal.throwIfAborted()
      return { bytes: new Uint8Array([4, 5]), adopt: 'saved-model' }
    }),
  }
  const document = new OfficeDocument({ path: '/workspace/report.docx', files, codec })
  return { document, files, codec }
}

it('loads a complete snapshot and saves against its observed version', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  expect(document.getSnapshot()).toMatchObject({ phase: 'ready', dirty: false, path: '/workspace/report.docx' })
  document.change('edited')
  expect(await document.save(new AbortController().signal)).toBe(true)
  expect(files.save).toHaveBeenCalledWith({ path: '/workspace/report.docx', contentBase64: 'BAU=',
    expected: { kind: 'replaceIfVersion', version: firstVersion } }, expect.any(AbortSignal))
  expect(document.getSnapshot()).toMatchObject({ phase: 'ready', dirty: false })
  expect(document.model()).toBe('saved-model')
})

it('captures edits before export and keeps later edits dirty when publication finishes', async () => {
  const { document, codec, files } = setup()
  await document.open(new AbortController().signal)
  document.change('edit A')
  const exported = Promise.withResolvers<{ bytes: Uint8Array; adopt: string }>()
  vi.mocked(codec.export).mockImplementationOnce(() => exported.promise)
  const saving = document.save(new AbortController().signal)
  document.change('edit B')
  exported.resolve({ bytes: new Uint8Array([10]), adopt: 'persisted A' })
  expect(await saving).toBe(true)
  expect(document.model()).toBe('edit B')
  expect(document.getSnapshot().dirty).toBe(true)
  expect(codec.export).toHaveBeenCalledWith('edit A', expect.objectContaining({ data: source }), expect.any(AbortSignal))
  expect(files.save).toHaveBeenCalledWith(expect.objectContaining({ contentBase64: 'Cg==' }), expect.any(AbortSignal))
  expect(await document.save(new AbortController().signal)).toBe(true)
  expect(files.save).toHaveBeenLastCalledWith(expect.objectContaining({
    expected: { kind: 'replaceIfVersion', version: secondVersion },
  }), expect.any(AbortSignal))
})

it('deduplicates overlapping saves and does not clear a newer dirty generation', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  document.change('A')
  const published = Promise.withResolvers<Awaited<ReturnType<OfficeDocumentFiles['save']>>>()
  vi.mocked(files.save).mockImplementationOnce(() => published.promise)
  const first = document.save(new AbortController().signal)
  const second = document.save(new AbortController().signal)
  document.change('B')
  published.resolve({ absolutePath: '/workspace/report.docx', version: secondVersion, bytes: 2, operation: 'update' })
  expect(await first).toBe(true)
  expect(await second).toBe(true)
  expect(files.save).toHaveBeenCalledTimes(1)
  expect(document.getSnapshot().dirty).toBe(true)
})

it('retains the model and original version after a conflict or export failure', async () => {
  const { document, files, codec } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  vi.mocked(files.save).mockRejectedValueOnce(new Error('conflict'))
  expect(await document.save(new AbortController().signal)).toBe(false)
  expect(document.getSnapshot()).toMatchObject({ phase: 'ready', dirty: true, error: { operation: 'save' } })
  vi.mocked(codec.export).mockRejectedValueOnce(new Error('invalid document'))
  expect(await document.save(new AbortController().signal)).toBe(false)
  expect(files.save).toHaveBeenCalledTimes(1)
  expect(document.model()).toBe('draft')
  expect(await document.save(new AbortController().signal)).toBe(true)
  expect(files.save).toHaveBeenLastCalledWith(expect.objectContaining({
    expected: { kind: 'replaceIfVersion', version: firstVersion },
  }), expect.any(AbortSignal))
})

it('saves a new copy without switching identity until publication succeeds', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  vi.mocked(files.save).mockRejectedValueOnce(new Error('destination exists'))
  expect(await document.saveAs({ path: '/workspace/copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
  expect(document.getSnapshot()).toMatchObject({ path: '/workspace/report.docx', dirty: true })
  vi.mocked(files.save).mockResolvedValueOnce({ absolutePath: '/workspace/copy.docx', version: secondVersion, bytes: 2, operation: 'create' })
  expect(await document.saveAs({ path: '/workspace/copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(true)
  expect(document.getSnapshot()).toMatchObject({ path: '/workspace/copy.docx', dirty: false })
})

it('refuses a second Save As destination while one publication is in progress', async () => {
  const { document, codec } = setup()
  await document.open(new AbortController().signal)
  const exported = Promise.withResolvers<{ bytes: Uint8Array; adopt: string }>()
  vi.mocked(codec.export).mockImplementationOnce(() => exported.promise)
  const saving = document.saveAs({ path: '/workspace/one.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)
  expect(await document.saveAs({ path: '/workspace/two.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
  exported.resolve({ bytes: new Uint8Array([1]), adopt: 'copy' })
  expect(await saving).toBe(true)
})

it('never rereads an unsaved document until its owner explicitly discards it', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  expect(await document.open(new AbortController().signal)).toBe(false)
  expect(files.read).toHaveBeenCalledTimes(1)
  expect(document.model()).toBe('draft')
  expect(await document.reloadDiscardingChanges(new AbortController().signal)).toBe(true)
  expect(document.getSnapshot().dirty).toBe(false)
  expect(files.read).toHaveBeenCalledTimes(2)
})

it('cancels old reads and prevents late parsing from replacing a newer document', async () => {
  const { document, codec } = setup()
  const first = Promise.withResolvers<string>()
  vi.mocked(codec.parse).mockImplementationOnce(() => first.promise).mockResolvedValueOnce('second')
  const opening = document.open(new AbortController().signal)
  await vi.waitFor(() => { expect(codec.parse).toHaveBeenCalledTimes(1) })
  expect(await document.open(new AbortController().signal)).toBe(true)
  first.resolve('first')
  expect(await opening).toBe(false)
  expect(document.model()).toBe('second')
})

it('disposes pending work and prevents later edits or publication', async () => {
  const { document, codec, files } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  const exported = Promise.withResolvers<{ bytes: Uint8Array; adopt: string }>()
  vi.mocked(codec.export).mockImplementationOnce(() => exported.promise)
  const saving = document.save(new AbortController().signal)
  const disposing = document.dispose()
  exported.resolve({ bytes: new Uint8Array([1]), adopt: 'late' })
  await disposing
  expect(await saving).toBe(false)
  expect(files.save).not.toHaveBeenCalled()
  document.change('late edit')
  expect(document.getSnapshot().phase).toBe('disposed')
})

it('publishes stable snapshots and removes state observers', async () => {
  const { document, files } = setup()
  const initial = document.getSnapshot()
  const changed = vi.fn()
  const stop = document.subscribe(changed)
  expect(document.getSnapshot()).toBe(initial)
  document.change('not opened')
  expect(await document.save(new AbortController().signal)).toBe(false)
  await document.open(new AbortController().signal)
  expect(await document.save(new AbortController().signal)).toBe(true)
  expect(files.save).not.toHaveBeenCalled()
  expect(changed).toHaveBeenCalled()
  stop()
  const calls = changed.mock.calls.length
  document.change('edited')
  expect(changed).toHaveBeenCalledTimes(calls)
})

it('does not discard edits made after an explicit reload request', async () => {
  const { document, codec } = setup()
  await document.open(new AbortController().signal)
  document.change('first draft')
  const parsed = Promise.withResolvers<string>()
  vi.mocked(codec.parse).mockImplementationOnce(() => parsed.promise)
  const reload = document.reloadDiscardingChanges(new AbortController().signal)
  await vi.waitFor(() => { expect(codec.parse).toHaveBeenCalledTimes(2) })
  document.change('new draft')
  parsed.resolve('reloaded')
  expect(await reload).toBe(false)
  expect(document.model()).toBe('new draft')
  expect(document.getSnapshot()).toMatchObject({ phase: 'ready', dirty: true })
})

it('refuses mismatched formats and writes during a load', async () => {
  const { document, codec } = setup()
  expect(await document.saveAs({ path: 'copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
  await document.open(new AbortController().signal)
  expect(await document.saveAs({ path: 'copy.xlsx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
  expect(document.getSnapshot().error?.reason).toBe('validation')
  const parsed = Promise.withResolvers<string>()
  vi.mocked(codec.parse).mockImplementationOnce(() => parsed.promise)
  const load = document.open(new AbortController().signal)
  expect(await document.save(new AbortController().signal)).toBe(false)
  parsed.resolve('next')
  expect(await load).toBe(true)
})

it('retains a draft when reloading fails and reports classified codec failures', async () => {
  const { document, codec, files } = setup()
  vi.mocked(files.read).mockRejectedValueOnce(new Error('missing'))
  expect(await document.open(new AbortController().signal)).toBe(false)
  expect(document.getSnapshot()).toMatchObject({ phase: 'idle', error: { operation: 'load' } })
  await document.open(new AbortController().signal)
  document.change('draft')
  vi.mocked(codec.parse).mockRejectedValueOnce(new Error('broken'))
  expect(await document.reloadDiscardingChanges(new AbortController().signal)).toBe(false)
  expect(document.model()).toBe('draft')
  expect(document.getSnapshot()).toMatchObject({ phase: 'ready', dirty: true })
  vi.mocked(codec.capture).mockImplementationOnce(() => { throw new OfficeDocumentError('validation') })
  expect(await document.save(new AbortController().signal)).toBe(false)
  expect(document.getSnapshot().error?.reason).toBe('validation')
})

it('shares identical Save As requests and refuses conflicting write intents', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  const written = Promise.withResolvers<Awaited<ReturnType<OfficeDocumentFiles['save']>>>()
  vi.mocked(files.save).mockImplementationOnce(() => written.promise)
  const first = document.saveAs({ path: 'copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)
  const same = document.saveAs({ path: 'copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)
  expect(first).toBe(same)
  expect(await document.saveAs({ path: 'copy.docx', expected: { kind: 'replaceIfVersion', version: firstVersion } },
    new AbortController().signal)).toBe(false)
  written.resolve({ absolutePath: 'copy.docx', version: secondVersion, bytes: 2, operation: 'create' })
  expect(await first).toBe(true)
})

it('does not treat different overwrite versions as the same publication', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  const written = Promise.withResolvers<Awaited<ReturnType<OfficeDocumentFiles['save']>>>()
  vi.mocked(files.save).mockImplementationOnce(() => written.promise)
  const pending = document.save(new AbortController().signal)
  expect(await document.open(new AbortController().signal)).toBe(false)
  const path = document.getSnapshot().path
  expect(await document.saveAs({ path, expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
  expect(await document.saveAs({ path, expected: { kind: 'replaceIfVersion', version: secondVersion } }, new AbortController().signal)).toBe(false)
  written.resolve({ absolutePath: path, version: secondVersion, bytes: 2, operation: 'update' })
  expect(await pending).toBe(true)
})

it('cancels a queued save before export and drains a confirmed write after disposal', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  document.change('draft')
  expect(await document.save(AbortSignal.abort())).toBe(false)
  expect(document.getSnapshot().error?.reason).toBe('cancelled')
  const written = Promise.withResolvers<Awaited<ReturnType<OfficeDocumentFiles['save']>>>()
  vi.mocked(files.save).mockImplementationOnce(() => written.promise)
  const saving = document.save(new AbortController().signal)
  await vi.waitFor(() => { expect(files.save).toHaveBeenCalledTimes(1) })
  const disposing = document.dispose()
  written.resolve({ absolutePath: 'report.docx', version: secondVersion, bytes: 2, operation: 'update' })
  expect(await saving).toBe(false)
  await disposing
  expect(await document.open(new AbortController().signal)).toBe(false)
  expect(await document.save(new AbortController().signal)).toBe(false)
  expect(await document.saveAs({ path: 'copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)).toBe(false)
})

it('refuses explicit reload while a clean Save As operation is publishing and after disposal', async () => {
  const { document, files } = setup()
  await document.open(new AbortController().signal)
  const written = Promise.withResolvers<Awaited<ReturnType<OfficeDocumentFiles['save']>>>()
  vi.mocked(files.save).mockImplementationOnce(() => written.promise)
  const saving = document.saveAs({ path: 'copy.docx', expected: { kind: 'createIfAbsent' } }, new AbortController().signal)
  expect(await document.reloadDiscardingChanges(new AbortController().signal)).toBe(false)
  expect(document.getSnapshot().error?.reason).toBe('busy')
  written.resolve({ absolutePath: 'copy.docx', version: secondVersion, bytes: 2, operation: 'create' })
  expect(await saving).toBe(true)
  await document.dispose()
  expect(await document.reloadDiscardingChanges(new AbortController().signal)).toBe(false)
})
