/** Office snapshots use the real binary filesystem and per-Session policy. */
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { outsideTempWorkspaceParent } from '../../../../scripts/snapshot-workspace-parent.ts'
import OfficeStorage from '../src/index.ts'

async function boot(mode: 'read-only' | 'workspace-write' = 'workspace-write', maxDocumentBytes = 8) {
  const root = await realpath(await mkdtemp(join(outsideTempWorkspaceParent(), '.uwork-office-storage-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode, workspaceRoot: root })
  await ctx.plugin(SandboxedFileSystem, { cwd: root })
  await ctx.plugin(OfficeStorage, { maxDocumentBytes, maxConcurrentOperations: 2 })
  return { ctx, root, storage: ctx.uworkOfficeStorage, session: Session.create(SessionId('office-file')) }
}

const signal = () => new AbortController().signal
const original = new Uint8Array([80, 75, 0, 255])
const edited = new Uint8Array([80, 75, 128, 0, 1])
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

it.each(['docx', 'xlsx', 'pptx'])('reads and version-saves complete %s bytes', async (extension) => {
  const { root, storage, session } = await boot()
  const path = `中文文档.${extension.toUpperCase()}`
  await writeFile(join(root, path), original)
  const loaded = await storage.read(session, path, signal())
  expect(await storage.stat(session, path, signal())).toEqual({
    absolutePath: loaded.absolutePath, version: loaded.version, bytes: loaded.bytes,
  })
  expect(loaded).toMatchObject({ absolutePath: join(root, path), bytes: 4 })
  expect(Uint8Array.from(loaded.data)).toEqual(original)
  const saved = await storage.save(session, {
    path, contentBase64: base64(edited), expected: { kind: 'replaceIfVersion', version: loaded.version },
  }, signal())
  expect(saved).toMatchObject({ absolutePath: loaded.absolutePath, bytes: 5, operation: 'update' })
  expect(new Uint8Array(await readFile(join(root, path)))).toEqual(edited)
  const second = await storage.read(session, path, signal())
  expect(second.version).toBe(saved.version)
  expect(Uint8Array.from(second.data)).toEqual(edited)
})

it('creates a Save As copy and refuses to overwrite an existing destination', async () => {
  const { root, storage, session } = await boot()
  const request = { path: 'copy.docx', contentBase64: base64(edited), expected: { kind: 'createIfAbsent' as const } }
  expect(await storage.save(session, request, signal())).toMatchObject({ operation: 'create', bytes: edited.length })
  await expect(storage.save(session, request, signal())).rejects.toMatchObject({
    code: 'office-file/failed', details: { reason: 'FS_NOT_OBSERVED' },
  })
  expect(new Uint8Array(await readFile(join(root, request.path)))).toEqual(edited)
})

it('preserves an external edit when the editor saves an old version', async () => {
  const { root, storage, session } = await boot()
  await writeFile(join(root, 'report.docx'), original)
  const loaded = await storage.read(session, 'report.docx', signal())
  await writeFile(join(root, 'report.docx'), new Uint8Array([1, 2, 3, 4, 5, 6]))
  await expect(storage.save(session, {
    path: 'report.docx', contentBase64: base64(edited), expected: { kind: 'replaceIfVersion', version: loaded.version },
  }, signal())).rejects.toMatchObject({ code: 'office-file/failed', details: { reason: 'FS_STALE_VERSION' } })
  expect(new Uint8Array(await readFile(join(root, 'report.docx')))).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
})

it('does not turn a read-only Session into a writable editor', async () => {
  const { root, storage, session } = await boot('read-only')
  await writeFile(join(root, 'report.xlsx'), original)
  const loaded = await storage.read(session, 'report.xlsx', signal())
  expect(await storage.capabilities(session, signal())).toEqual({ maxDocumentBytes: 8, writePolicy: 'read-only' })
  await expect(storage.save(session, {
    path: 'report.xlsx', contentBase64: base64(edited), expected: { kind: 'replaceIfVersion', version: loaded.version },
  }, signal())).rejects.toMatchObject({ code: 'office-file/failed', details: { reason: 'FS_SANDBOX_DENIED' } })
  expect(new Uint8Array(await readFile(join(root, 'report.xlsx')))).toEqual(original)
})

it.each(['AA', 'A===', 'AB==', 'AAAA\n', '_w=='])('rejects noncanonical Base64 %j before creating a document', async (contentBase64) => {
  const { root, storage, session } = await boot()
  await expect(storage.save(session, {
    path: 'invalid.pptx', contentBase64, expected: { kind: 'createIfAbsent' },
  }, signal())).rejects.toMatchObject({ code: 'office-file/failed', details: { reason: 'invalid-base64' } })
  await expect(readFile(join(root, 'invalid.pptx'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses oversized reads and writes without truncating files', async () => {
  const { root, storage, session } = await boot()
  const bytes = new Uint8Array(9).fill(42)
  await writeFile(join(root, 'large.xlsx'), bytes)
  await expect(storage.read(session, 'large.xlsx', signal())).rejects.toMatchObject({
    code: 'office-file/failed', details: { reason: 'FS_TOO_LARGE' },
  })
  await expect(storage.save(session, {
    path: 'large-copy.xlsx', contentBase64: base64(bytes), expected: { kind: 'createIfAbsent' },
  }, signal())).rejects.toMatchObject({ code: 'office-file/failed', details: { reason: 'FS_TOO_LARGE' } })
  expect(new Uint8Array(await readFile(join(root, 'large.xlsx')))).toEqual(bytes)
})

it('refuses cancelled calls and calls retained after unloading the plugin', async () => {
  const { storage, session, ctx } = await boot()
  await expect(storage.read(session, 'report.docx', AbortSignal.abort())).rejects.toMatchObject({ code: 'gateway/cancelled' })
  await ctx.fiber.dispose()
  await expect(storage.read(session, 'report.docx', signal())).rejects.toMatchObject({ code: 'gateway/cancelled' })
})

it('admits the exact configured byte cap and empty binary snapshots', async () => {
  const { root, storage, session } = await boot()
  for (const bytes of [new Uint8Array(8).fill(255), new Uint8Array(0)]) {
    const path = `${bytes.length}.xlsx`
    await storage.save(session, { path, contentBase64: base64(bytes), expected: { kind: 'createIfAbsent' } }, signal())
    expect(Uint8Array.from((await storage.read(session, path, signal())).data)).toEqual(bytes)
    expect(new Uint8Array(await readFile(join(root, path)))).toEqual(bytes)
  }
})

it.each(['report.doc', 'report.xlsm', 'report.pdf', 'report.docx\0'])('refuses unsupported destination %j', async (path) => {
  const { storage, session } = await boot()
  await expect(storage.save(session, { path, contentBase64: base64(edited), expected: { kind: 'createIfAbsent' } }, signal()))
    .rejects.toMatchObject({ code: 'office-file/failed', details: { reason: 'unsupported-format' } })
})

it('rejects directories, missing files, and final-component symbolic links', async () => {
  const { root, storage, session } = await boot()
  await expect(storage.read(session, 'missing.pptx', signal())).rejects.toMatchObject({ details: { reason: 'FS_NOT_FOUND' } })
  await mkdir(join(root, 'directory.docx'))
  await expect(storage.read(session, 'directory.docx', signal())).rejects.toMatchObject({ details: { reason: 'FS_NOT_REGULAR_FILE' } })
  await writeFile(join(root, 'source.docx'), original)
  await symlink(join(root, 'source.docx'), join(root, 'link.docx'))
  await expect(storage.save(session, {
    path: 'link.docx', contentBase64: base64(edited), expected: { kind: 'createIfAbsent' },
  }, signal())).rejects.toMatchObject({ details: { reason: 'FS_NOT_REGULAR_FILE' } })
  expect(new Uint8Array(await readFile(join(root, 'source.docx')))).toEqual(original)
})

it('uses the Session workspace and refuses writes through a symlinked parent outside it', async () => {
  const { root, ctx, storage, session } = await boot()
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const scoped = Session.create(session.id, [], { ...session.header, cwd: workspace })
  await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  const request = { contentBase64: base64(edited), expected: { kind: 'createIfAbsent' as const } }
  const saved = await storage.save(scoped, { ...request, path: 'allowed.docx' }, signal())
  expect(saved.absolutePath).toBe(join(workspace, 'allowed.docx'))
  await expect(storage.save(scoped, { ...request, path: '../outside/denied.docx' }, signal()))
    .rejects.toMatchObject({ details: { reason: 'FS_SANDBOX_DENIED' } })
  await expect(storage.save(scoped, { ...request, path: 'escape/denied.docx' }, signal()))
    .rejects.toMatchObject({ details: { reason: 'FS_SANDBOX_DENIED' } })
  await writeFile(join(outside, 'private.xlsx'), original)
  await expect(storage.read(scoped, '../outside/private.xlsx', signal()))
    .rejects.toMatchObject({ details: { reason: 'FS_SANDBOX_DENIED' } })
  await expect(storage.stat(scoped, 'escape/private.xlsx', signal()))
    .rejects.toMatchObject({ details: { reason: 'FS_SANDBOX_DENIED' } })
  expect(ctx.sandboxPolicy.resolve({ session: scoped }).workspaceRoot).toBe(workspace)
})

it('refuses a source replaced between reading bytes and checking its version', async () => {
  const { root, ctx, storage, session } = await boot()
  await writeFile(join(root, 'report.docx'), original)
  const read = ctx.fs.readBytes.bind(ctx.fs)
  vi.spyOn(ctx.fs, 'readBytes').mockImplementationOnce(async (...args) => {
    const bytes = await read(...args)
    await writeFile(join(root, 'report.docx'), edited)
    return bytes
  })
  await expect(storage.read(session, 'report.docx', signal())).rejects.toMatchObject({ details: { reason: 'FS_STALE_VERSION' } })
})

it('bounds admitted operations and cancels and drains active reads on unload', async () => {
  const { root, ctx, storage, session } = await boot()
  await writeFile(join(root, 'report.docx'), original)
  const started = Promise.withResolvers<undefined>()
  let reads = 0
  vi.spyOn(ctx.fs, 'readBytes').mockImplementation(async (_target, active): Promise<Uint8Array> => {
    reads += 1
    if (reads === 2) started.resolve(undefined)
    await new Promise<void>((resolve) => { active!.addEventListener('abort', () => { resolve() }, { once: true }) })
    active!.throwIfAborted()
    return original
  })
  const pending = [storage.read(session, 'report.docx', signal()), storage.read(session, 'report.docx', signal())]
  const settled = Promise.allSettled(pending)
  await started.promise
  await expect(storage.read(session, 'report.docx', signal())).rejects.toMatchObject({ details: { reason: 'busy' } })
  await ctx.fiber.dispose()
  expect((await settled).map(result => result.status === 'rejected' ? remoteErrorOf(result.reason)?.code : 'fulfilled'))
    .toEqual(['gateway/cancelled', 'gateway/cancelled'])
})

it('preserves a backend failure for centralized diagnostics without retrying', async () => {
  const { ctx, storage, session } = await boot()
  const failure = new Error('backend disconnected')
  const stat = vi.spyOn(ctx.fs, 'lstat').mockRejectedValueOnce(failure)
  await expect(storage.read(session, 'report.docx', signal())).rejects.toBe(failure)
  expect(stat).toHaveBeenCalledTimes(1)
})

it('cancels an admitted operation when the caller aborts', async () => {
  const { root, ctx, storage, session } = await boot()
  await writeFile(join(root, 'report.docx'), original)
  const caller = new AbortController()
  vi.spyOn(ctx.fs, 'readBytes').mockImplementationOnce(async () => {
    caller.abort()
    throw caller.signal.reason
  })
  await expect(storage.read(session, 'report.docx', caller.signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
})

it('rejects an overlong encoded payload before decoding it', async () => {
  const { storage, session } = await boot()
  await expect(storage.save(session, {
    path: 'oversize.docx', contentBase64: base64(new Uint8Array(10)), expected: { kind: 'createIfAbsent' },
  }, signal())).rejects.toMatchObject({ details: { reason: 'FS_TOO_LARGE' } })
})

it('rejects a regular path that resolves to a directory before the source stat', async () => {
  const { ctx, storage, session } = await boot()
  const target = await ctx.fs.resolve('changed.docx')
  const root = await ctx.fs.resolve('.')
  const directory = await ctx.fs.stat(root)
  vi.spyOn(ctx.fs, 'lstat').mockResolvedValueOnce({ type: 'file', version: directory!.version })
  vi.spyOn(ctx.fs, 'resolve').mockResolvedValueOnce(root).mockResolvedValueOnce(target)
  vi.spyOn(ctx.fs, 'stat').mockResolvedValueOnce(directory)
  await expect(storage.read(session, 'changed.docx', signal())).rejects.toMatchObject({ details: { reason: 'FS_NOT_REGULAR_FILE' } })
})

it('accepts an eight MiB snapshot without recursive Base64 matching or truncation', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(255)
  const { storage, session } = await boot('workspace-write', bytes.length)
  const saved = await storage.save(session, {
    path: 'full.xlsx', contentBase64: base64(bytes), expected: { kind: 'createIfAbsent' },
  }, signal())
  expect(saved.bytes).toBe(bytes.length)
  const loaded = await storage.read(session, 'full.xlsx', signal())
  expect(loaded.bytes).toBe(bytes.length)
  expect(loaded.data.every(value => value === 255)).toBe(true)
})

it('keeps an unknown backend file size absent from metadata', async () => {
  const { root, ctx, storage, session } = await boot()
  await writeFile(join(root, 'unknown.xlsx'), original)
  const target = await ctx.fs.resolve('unknown.xlsx')
  const info = await ctx.fs.stat(target)
  vi.spyOn(ctx.fs, 'stat').mockResolvedValueOnce({ type: 'file', version: info!.version })
  expect(await storage.stat(session, 'unknown.xlsx', signal())).toEqual({ absolutePath: join(root, 'unknown.xlsx'), version: info!.version })
})
