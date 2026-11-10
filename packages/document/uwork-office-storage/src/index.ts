/** Host Office document reads and version-guarded binary publication through the composed filesystem. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { OfficeEditorCapabilities, OfficeFileFailure, OfficeFileSaved, OfficeFileSaveRequest, OfficeFileSnapshot, OfficeFileStatus } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Office editor file admission and guarded saves; no model tools. */
    uworkOfficeStorage: UworkOfficeStorage
  }
}

/** Deployment limits applied to every read and save. */
export interface Config {
  /** Inclusive complete document byte cap, before Base64 encoding. */
  readonly maxDocumentBytes: number
  /** Concurrent reads and saves admitted by this provider. */
  readonly maxConcurrentOperations: number
}

/** Optional Office editor backend; every mutation uses the calling Session's current write policy. */
export class UworkOfficeStorage extends TypertRemoteService {
  static inject = ['fs', 'sandboxPolicy']
  static Config: z<Config> = z.object({
    maxDocumentBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER - 1).default(8 * 1024 * 1024),
    maxConcurrentOperations: z.number().step(1).min(1).default(8),
  })

  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()

  /**
   * @param ctx - filesystem and per-Session sandbox policy owner.
   * @param config - complete-document and concurrent-operation limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'uworkOfficeStorage')
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.operations)
    })
  }

  /**
   * Query editor admission hints without granting file access or changing policy.
   * @param session - authorized live Session whose current policy is reported.
   * @param signal - caller cancellation.
   * @returns document cap and current Session policy; saving remains subject to workspace and filesystem checks.
   */
  @Remote
  capabilities(session: Session, signal: AbortSignal): Promise<OfficeEditorCapabilities> {
    return this.run(signal, () => Promise.resolve({
      maxDocumentBytes: this.config.maxDocumentBytes,
      writePolicy: this.ctx.sandboxPolicy.resolve({ session }).mode,
    }))
  }

  /**
   * Inspect a regular Office file without reading its bytes.
   * @param session - authorized live Session used to resolve relative paths.
   * @param path - absolute source or Session-relative path.
   * @param signal - caller cancellation.
   * @returns canonical source identity and byte size when the backend reports it.
   */
  @Remote
  stat(session: Session, path: string, signal: AbortSignal): Promise<OfficeFileStatus> {
    return this.run(signal, async (active) => {
      const { target, info } = await this.locate(session, path, active)
      return { absolutePath: this.ctx.fs.processPath(target), version: info.version,
        ...info.size === undefined ? {} : { bytes: info.size } }
    })
  }

  /**
   * Read a complete DOCX, XLSX, or PPTX with a stable observed filesystem version.
   * @param session - authorized live Session supplied by the Remote lookup.
   * @param path - absolute source or path relative to the Session workspace.
   * @param signal - caller cancellation; plugin unload also cancels the read.
   * @returns the complete bytes and the version to use for a later guarded save.
   */
  @Remote
  read(session: Session, path: string, signal: AbortSignal): Promise<OfficeFileSnapshot> {
    return this.run(signal, async (active) => {
      const { target, info: before } = await this.locate(session, path, active)
      const data = await this.ctx.fs.readBytes(target, active, this.config.maxDocumentBytes)
      const after = await this.ctx.fs.stat(target, active)
      if (after?.type !== 'file' || after.version !== before.version) {
        throw new FsError('Office source changed while reading.', 'FS_STALE_VERSION')
      }
      active.throwIfAborted()
      return { absolutePath: this.ctx.fs.processPath(target), version: before.version, bytes: data.byteLength, data }
    })
  }

  /**
   * Publish a complete serialized document under an explicit create or observed-version intent.
   * @param session - authorized live Session whose current policy controls the mutation.
   * @param request - destination, complete Base64 snapshot, and required write intent.
   * @param signal - cancellation before publication; an interrupted response requires reloading before retry.
   * @returns confirmed publication metadata; never implies that newer editor changes were saved.
   */
  @Remote
  save(session: Session, request: OfficeFileSaveRequest, signal: AbortSignal): Promise<OfficeFileSaved> {
    return this.run(signal, async (active) => {
      const bytes = this.decode(request.contentBase64)
      const target = await this.target(session, request.path, active)
      const policy = this.ctx.sandboxPolicy.resolve({ session })
      if (policy.mode === 'read-only') throw new FsError('Office editing is read-only in this Session.', 'FS_SANDBOX_DENIED')
      const saved = await this.ctx.fs.writeBytes(target, bytes, request.expected, active, policy)
      return { absolutePath: this.ctx.fs.processPath(target), version: saved.version, bytes: bytes.byteLength, operation: saved.operation }
    })
  }

  private decode(content: string): Uint8Array {
    if (content.length > 4 * Math.ceil(this.config.maxDocumentBytes / 3)) {
      throw new FsError('Office document exceeds the byte cap.', 'FS_TOO_LARGE')
    }
    if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
      throw this.failure('invalid-base64')
    }
    const bytes = Buffer.from(content, 'base64')
    if (bytes.toString('base64') !== content) throw this.failure('invalid-base64')
    if (bytes.byteLength > this.config.maxDocumentBytes) throw new FsError('Office document exceeds the byte cap.', 'FS_TOO_LARGE')
    return bytes
  }

  private async target(session: Session, path: string, signal: AbortSignal): Promise<FsTarget> {
    if (!/\.(?:docx|xlsx|pptx)$/i.test(path) || path.includes('\0')) throw this.failure('unsupported-format')
    const cwd = session.header.cwd ?? this.ctx.sandboxPolicy.workspaceRoot
    const entry = await this.ctx.fs.lstat(path, { cwd }, signal)
    if (entry !== undefined && entry.type !== 'file') throw new FsError('Office target is not a regular file.', 'FS_NOT_REGULAR_FILE')
    const [root, target] = await Promise.all([
      this.ctx.fs.resolve(cwd, { signal }),
      this.ctx.fs.resolve(path, { cwd, signal }),
    ])
    if (!this.ctx.fs.contains(root, target)) throw new FsError('Office target is outside the Session workspace.', 'FS_SANDBOX_DENIED')
    return target
  }

  private async locate(session: Session, path: string, signal: AbortSignal): Promise<{ target: FsTarget; info: FsInfo }> {
    const target = await this.target(session, path, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new FsError('Office file is missing.', 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError('Office source is not a regular file.', 'FS_NOT_REGULAR_FILE')
    return { target, info }
  }

  private async run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    if (active.aborted) throw new RemoteError('gateway/cancelled', 'Office file operation was cancelled.', {})
    if (this.operations.size >= this.config.maxConcurrentOperations) throw this.failure('busy')
    const pending = Promise.resolve().then(() => { active.throwIfAborted(); return operation(active) })
    this.operations.add(pending)
    try {
      return await pending
    } catch (cause) {
      if (signal.aborted || this.lifetime.signal.aborted) throw new RemoteError('gateway/cancelled', 'Office file operation was cancelled.', {}, { cause })
      if (cause instanceof FsError) throw new RemoteError('office-file/failed', 'Office file operation failed.', { reason: cause.code }, { cause })
      throw cause
    } finally {
      this.operations.delete(pending)
    }
  }

  private failure(reason: OfficeFileFailure): RemoteError<'office-file/failed'> {
    return new RemoteError('office-file/failed', 'Office file operation failed.', { reason })
  }
}

export default UworkOfficeStorage
