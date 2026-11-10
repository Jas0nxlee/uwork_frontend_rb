/** Portable, bounded extraction of SkillHub ZIP files into an owned empty directory. */
import { createHash } from 'node:crypto'
import { mkdir, open as openFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { finished } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { open as openZip, type Entry, type ZipFile } from 'yauzl'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Limits enforced before and during decompression. */
export interface ArchiveLimits {
  /** Maximum entries, including directory entries. */
  readonly maxArchiveEntries: number
  /** Maximum bytes in one decompressed file. */
  readonly maxFileBytes: number
  /** Maximum decompressed bytes across all files. */
  readonly maxExpandedBytes: number
  /** Maximum UTF-8 bytes in one relative path. */
  readonly maxPathBytes: number
}

/** One verified regular file, relative to the skill content directory. */
export interface InstalledFile {
  /** Original portable POSIX path, used by the content fingerprint. */
  readonly path: string
  /** Lowercase SHA-256 digest of the decompressed file. */
  readonly sha256: string
  /** Actual decompressed bytes. */
  readonly bytes: number
}

/**
 * Refuse unsafe or inconsistent package content without reporting untrusted text.
 * @param reason - stable rejection category.
 * @returns never; always throws a structured package rejection.
 */
export function packageFailure(reason: 'path' | 'symlink' | 'duplicate' | 'format' | 'fingerprint' | 'identity' | 'version' | 'limit' | 'missing-skill'): never {
  throw new RemoteError('uwork-company-market/invalid-package', 'The company skill package was rejected', { reason })
}

/**
 * Validate a portable archive-relative file or directory name.
 * @param path - POSIX path without a directory's trailing slash.
 * @param maxBytes - configured path-byte budget.
 * @returns the original path; no normalization changes the fingerprint input.
 */
export function portablePath(path: string, maxBytes: number): string {
  if (!path || Buffer.byteLength(path) > maxBytes || /[\\\x00-\x1f\x7f<>:"|?*]/u.test(path)) packageFailure('path')
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/u.test(part) || Buffer.byteLength(part) > 255
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu.test(part)) packageFailure('path')
  }
  return path
}

/**
 * Compute SkillHub's compound SHA-256 over sorted paths and individual file hashes.
 * @param files - verified file records; directories are excluded.
 * @returns canonical fingerprint with its sha256 prefix.
 */
export function contentFingerprint(files: readonly InstalledFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort(compareFiles)) {
    hash.update(`${file.path}:${file.sha256}\n`, 'utf8')
  }
  return `sha256:${hash.digest('hex')}`
}

function compareFiles(a: InstalledFile, b: InstalledFile): number {
  return Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
}

function nextEntry(zip: ZipFile, signal: AbortSignal): Promise<Entry | undefined> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { zip.off('entry', entry); zip.off('end', end); signal.removeEventListener('abort', abort) }
    const entry = (value: Entry) => { cleanup(); resolve(value) }
    const end = () => { cleanup(); resolve(undefined) }
    const abort = () => { cleanup(); reject(new Error('Company package extraction aborted', { cause: signal.reason })) }
    zip.once('entry', entry)
    zip.once('end', end)
    signal.addEventListener('abort', abort, { once: true })
    zip.readEntry()
  })
}

/**
 * Extract only regular files, reject links/collisions/bombs, and verify the compound content fingerprint.
 * @param archive - owned downloaded ZIP path.
 * @param destination - owned empty content directory.
 * @param expected - fingerprint from the version resolver.
 * @param limits - decompression and path limits.
 * @param signal - caller, service and installation deadline.
 * @returns manifest of the verified files, sorted by their original POSIX paths.
 */
export async function extractPackage(
  archive: string, destination: string, expected: string, limits: ArchiveLimits, signal: AbortSignal,
): Promise<InstalledFile[]> {
  signal.throwIfAborted()
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(archive, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, value) => {
      if (error) reject(new RemoteError('uwork-company-market/invalid-package', 'Invalid company skill ZIP', { reason: 'format' }, { cause: error }))
      else resolve(value)
    })
  })
  const failure = new AbortController()
  const active = AbortSignal.any([signal, failure.signal])
  const onError = (error: Error) => { failure.abort(error) }
  zip.on('error', onError)
  const nodes = new Map<string, { path: string; file: boolean }>()
  const explicitDirectories = new Set<string>()
  const files: InstalledFile[] = []
  let count = 0
  let declaredBytes = 0
  try {
    for (;;) {
      active.throwIfAborted()
      const entry = await nextEntry(zip, active)
      if (entry === undefined) break
      if (++count > limits.maxArchiveEntries) packageFailure('limit')
      const directory = entry.fileName.endsWith('/')
      const path = portablePath(directory ? entry.fileName.slice(0, -1) : entry.fileName, limits.maxPathBytes)
      const type = (entry.externalFileAttributes >>> 16) & 0o170000
      if (type !== 0 && type !== 0o100000 && type !== 0o040000) packageFailure('symlink')
      if ((type === 0o040000) !== directory && type !== 0) packageFailure('format')
      if (entry.isEncrypted()) packageFailure('format')
      const parts = path.split('/')
      for (let i = 1; i <= parts.length; i++) {
        const part = parts.slice(0, i).join('/')
        const key = part.normalize('NFC').toLowerCase()
        const previous = nodes.get(key)
        const file = i === parts.length && !directory
        if (previous !== undefined && (previous.path !== part || previous.file || file)) packageFailure('duplicate')
        nodes.set(key, { path: part, file })
      }
      if (directory) {
        if (explicitDirectories.has(path)) packageFailure('duplicate')
        explicitDirectories.add(path)
        continue
      }
      if (!Number.isSafeInteger(entry.uncompressedSize)) packageFailure('format')
      declaredBytes += entry.uncompressedSize
      if (entry.uncompressedSize > limits.maxFileBytes || declaredBytes > limits.maxExpandedBytes) packageFailure('limit')
      const target = join(destination, ...parts)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      const executable = ((entry.externalFileAttributes >>> 16) & 0o111) !== 0
      const output = await openFile(target, 'wx', executable ? 0o700 : 0o600)
      try {
        const stream = await new Promise<Readable>((resolve, reject) => {
          zip.openReadStream(entry, (error, stream) => {
            if (error) reject(new RemoteError('uwork-company-market/invalid-package', 'Invalid company skill ZIP entry', { reason: 'format' }, { cause: error }))
            else resolve(stream)
          })
        })
        const abort = () => { stream.destroy(new Error('Company package extraction aborted', { cause: active.reason })) }
        active.addEventListener('abort', abort, { once: true })
        if (active.aborted) abort()
        let bytes = 0
        const hash = createHash('sha256')
        try {
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            active.throwIfAborted()
            bytes += chunk.length
            hash.update(chunk)
            try { await output.writeFile(chunk) }
            catch (error) {
              throw new RemoteError('uwork-company-market/install-failed', 'Could not write company skill content', { outcome: 'unchanged' }, { cause: error })
            }
          }
        } catch (error) {
          if (error instanceof RemoteError || active.aborted) throw error
          throw new RemoteError('uwork-company-market/invalid-package', 'Invalid company skill compressed data', { reason: 'format' }, { cause: error })
        } finally {
          active.removeEventListener('abort', abort)
          stream.destroy()
          try { await finished(stream, { cleanup: true }) }
          catch (error) { void error /* The read or abort failure above owns the outcome; wait only for cleanup. */ }
        }
        files.push({ path, sha256: hash.digest('hex'), bytes })
      } finally { await output.close() }
    }
    if (!files.some(file => file.path === 'SKILL.md' && file.bytes > 0)) packageFailure('missing-skill')
    if (contentFingerprint(files) !== expected) packageFailure('fingerprint')
    return files.sort(compareFiles)
  } catch (error) {
    signal.throwIfAborted()
    if (failure.signal.aborted) {
      throw new RemoteError('uwork-company-market/invalid-package', 'Invalid company skill ZIP structure', { reason: 'format' }, { cause: error })
    }
    throw error
  } finally {
    await new Promise<void>((resolve) => { zip.once('close', resolve); zip.close() })
    zip.off('error', onError)
  }
}
