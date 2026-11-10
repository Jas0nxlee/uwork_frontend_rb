// @vitest-environment jsdom
/** DOCX admission, fixed engine snapshots, and metadata refresh after confirmed export. */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { beforeEach, expect, it, vi } from 'vitest'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { OfficeFileSnapshot } from '@deepseek-ai/dsh-uwork-office-storage/types'
import type { WordSnapshot } from '../src/client/word-engine.ts'
import { createOfficeEngineQueue } from '../src/client/engine-queue.ts'
import { wordCodec, acceptWordLoss } from '../src/client/word.ts'
import { acceptedText, rejectedText } from '../src/client/formats/docx/docxTrackChanges.ts'

const engines = vi.hoisted(() => ({
  importWord: vi.fn<(bytes: ArrayBuffer, signal: AbortSignal) => Promise<WordSnapshot>>(),
  exportWord: vi.fn<(snapshot: WordSnapshot, signal: AbortSignal) => Promise<ArrayBuffer>>(),
}))
vi.mock('../src/client/word-engine.ts', () => engines)
const signal = () => new AbortController().signal
const options = { maxDocumentXmlBytes: 100_000, minRetainedTextRatio: 0.8, author: 'Author', now: () => '2026-11-10T00:00:00Z' }
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
function snapshot(text = '正文A'): WordSnapshot {
  return { value: { version: '1', options: {}, data: { main: [{ value: text }] } } }
}
async function documentBytes(body = paragraph('正文A')): Promise<Uint8Array<ArrayBuffer>> {
  const zip = await JSZip.loadAsync(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/report.docx')))
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`)
  return Uint8Array.from(await zip.generateAsync({ type: 'uint8array' }))
}
function baseline(data: Uint8Array): OfficeFileSnapshot {
  return { absolutePath: '/workspace/report.docx', version: FsVersion('source'), data, bytes: data.length }
}
beforeEach(() => {
  engines.importWord.mockReset().mockResolvedValue(snapshot())
  engines.exportWord.mockReset().mockImplementation(async () => (await documentBytes(paragraph('正文B'))).buffer)
})

it('admits valid Word bytes and rejects invalid archives before engine import', async () => {
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(await documentBytes(), signal())
  expect(opened).toMatchObject({ acceptedLoss: true, trackChanges: true, warnings: [] })
  expect(opened.snapshot?.()).toEqual(snapshot())
  engines.importWord.mockClear()
  await expect(codec.parse(new Uint8Array([1]), signal())).rejects.toMatchObject({ reason: 'validation' })
  expect(engines.importWord).not.toHaveBeenCalled()
})

it('enforces the expanded main-document cap before constructing an engine', async () => {
  await expect(wordCodec({ ...options, maxDocumentXmlBytes: 1 }, createOfficeEngineQueue()).parse(await documentBytes(), signal()))
    .rejects.toMatchObject({ reason: 'too-large' })
  expect(engines.importWord).not.toHaveBeenCalled()
})

it('defers lossy imports until their conversion is accepted', async () => {
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(await documentBytes(paragraph('正文A') + '<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>'), signal())
  expect(opened).toMatchObject({ acceptedLoss: false, snapshot: undefined, warnings: [{ kind: 'footnotes', count: 1 }] })
  expect(engines.importWord).not.toHaveBeenCalled()
  expect(() => codec.capture(opened)).toThrow()
  const accepted = await acceptWordLoss(opened, signal(), createOfficeEngineQueue())
  expect(accepted.acceptedLoss).toBe(true)
  expect(engines.importWord).toHaveBeenCalledTimes(1)
})

it('captures independent engine data before asynchronous serialization', async () => {
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(await documentBytes(), signal())
  const live = snapshot('第一版')
  const captured = codec.capture({ ...opened, snapshot: () => live })
  live.value.data.main.push({ value: '第二版' })
  expect(captured.snapshot?.().value.data.main).toEqual([{ value: '第一版' }])
})

it('records edits as Word revisions and refreshes the preservation baseline for subsequent saves', async () => {
  const bytes = await documentBytes()
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(bytes, signal())
  const published = await codec.export(codec.capture(opened), baseline(bytes), signal())
  const zip = await JSZip.loadAsync(published.bytes)
  const main = zip.file('word/document.xml')
  if (main === null) throw new Error('Missing exported Word main part')
  const xml = await main.async('string')
  expect(acceptedText(xml)).toBe('正文B')
  expect(rejectedText(xml)).toBe('正文A')
  expect(published.adopt.reviewSource).toEqual(published.bytes.buffer)
  expect(published.adopt.preservation.paragraphs.length).toBeGreaterThan(0)
  const later = { ...opened, snapshot: () => snapshot('较晚修改'), trackChanges: false }
  const adopted = codec.committed(later, published.adopt, false)
  expect(adopted.snapshot?.()).toEqual(snapshot('较晚修改'))
  expect(adopted.reviewSource).toBe(published.adopt.reviewSource)
  expect(adopted.trackChanges).toBe(false)
  expect(codec.committed(opened, published.adopt, true).snapshot).toBe(published.adopt.snapshot)
})

it('refuses a lossy model without publishing an export', async () => {
  const bytes = await documentBytes()
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(bytes, signal())
  await expect(codec.export({ ...opened, acceptedLoss: false }, baseline(bytes), signal())).rejects.toMatchObject({ reason: 'validation' })
  expect(engines.exportWord).not.toHaveBeenCalled()
})

it('refuses collapsed exports and honours cancellation before returning output bytes', async () => {
  const bytes = await documentBytes(paragraph('正文'.repeat(100)))
  const codec = wordCodec(options, createOfficeEngineQueue())
  const opened = await codec.parse(bytes, signal())
  await expect(codec.export({ ...opened, trackChanges: false }, baseline(bytes), signal())).rejects.toMatchObject({ reason: 'validation' })
  const aborted = new AbortController()
  aborted.abort()
  await expect(codec.parse(bytes, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
  const normal = await documentBytes()
  const model = await codec.parse(normal, signal())
  await expect(codec.export(model, baseline(normal), aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
