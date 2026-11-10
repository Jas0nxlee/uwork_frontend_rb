import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '../src/index.ts'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-binary-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalFileSystem, { cwd: root })
  onTestFinished(async () => { await fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, fs: ctx.fs as LocalFileSystem }
}

it('creates and version-replaces raw Office bytes without text decoding', async () => {
  const { root, fs } = await setup()
  const target = await fs.resolve('文档.docx')
  const bytes = new Uint8Array([0x50, 0x4b, 0, 0xff, 0xfe, 0x80])
  const first = await fs.writeBytes(target, bytes, { kind: 'createIfAbsent' })
  expect(first.operation).toBe('create')
  expect(new Uint8Array(await readFile(join(root, '文档.docx')))).toEqual(bytes)
  const second = await fs.writeBytes(target, new Uint8Array([0, 255]), { kind: 'replaceIfVersion', version: first.version })
  expect(second.operation).toBe('update')
  expect(second.version).not.toBe(first.version)
  await expect(fs.writeBytes(target, bytes, { kind: 'replaceIfVersion', version: first.version })).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  await expect(fs.writeBytes(target, bytes, { kind: 'createIfAbsent' })).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  expect([...await readFile(join(root, '文档.docx'))]).toEqual([0, 255])
})

it('rejects an external edit during staging and preserves the external bytes', async () => {
  const { root, fs } = await setup()
  const path = join(root, 'file.xlsx')
  await writeFile(path, new Uint8Array([1]))
  const target = await fs.resolve(path)
  const info = await fs.stat(target)
  if (!info) throw new Error('missing fixture')
  fs.internals.inspectTemp = async () => { await writeFile(path, new Uint8Array([7, 8, 9])) }
  await expect(fs.writeBytes(target, new Uint8Array([2]), { kind: 'replaceIfVersion', version: info.version }))
    .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
  expect([...await readFile(path)]).toEqual([7, 8, 9])
})

it('serializes competing saves so only one can replace an observed version', async () => {
  const { fs } = await setup()
  const target = await fs.resolve('file.pptx')
  const initial = await fs.writeBytes(target, new Uint8Array([1]), { kind: 'createIfAbsent' })
  const saves = await Promise.allSettled([2, 3].map(value => fs.writeBytes(target, new Uint8Array([value]), {
    kind: 'replaceIfVersion', version: initial.version,
  })))
  expect(saves.filter(save => save.status === 'fulfilled')).toHaveLength(1)
  expect(saves.filter(save => save.status === 'rejected')).toHaveLength(1)
})


it('cancels a staged binary save without replacing the original or leaking staging files', async () => {
  const { root, fs } = await setup()
  const target = await fs.resolve('file.docx')
  const initial = await fs.writeBytes(target, new Uint8Array([1]), { kind: 'createIfAbsent' })
  const controller = new AbortController()
  fs.internals.inspectTemp = () => { controller.abort() }
  await expect(fs.writeBytes(target, new Uint8Array([2]), {
    kind: 'replaceIfVersion', version: initial.version,
  }, controller.signal)).rejects.toMatchObject({ code: 'FS_ABORTED' })
  expect([...await readFile(join(root, 'file.docx'))]).toEqual([1])
  expect(await readdir(root)).toEqual(['file.docx'])
})

it.each(['typed-array', 'buffer'])('captures a fixed %s snapshot while the caller keeps editing', async (kind) => {
  const { root, fs } = await setup()
  const target = await fs.resolve('file.docx')
  const bytes = kind === 'buffer' ? Buffer.from([1, 2, 3]) : new Uint8Array([1, 2, 3])
  const saving = fs.writeBytes(target, bytes, { kind: 'createIfAbsent' })
  bytes.fill(9)
  await saving
  expect([...await readFile(join(root, 'file.docx'))]).toEqual([1, 2, 3])
})
