/** Owns one Office document's source baseline, edit generations, and asynchronous publication. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { OfficeFileSaved, OfficeFileSaveRequest, OfficeFileSnapshot } from '@deepseek-ai/dsh-uwork-office-storage/types'
import type { FsWriteIntent } from '@deepseek-ai/dsh-fs'

/** Authorized file operations bound to the document's Session by the plugin. */
export interface OfficeDocumentFiles {
  /**
   * Read one complete authorized document snapshot.
   * @param path - authorized document path.
   * @param signal - operation cancellation.
   * @returns complete observed bytes.
   */
  readonly read: (path: string, signal: AbortSignal) => Promise<OfficeFileSnapshot>
  /**
   * Publish a captured snapshot through guarded file storage.
   * @param request - full serialized snapshot and guarded destination.
   * @param signal - cancellation.
   * @returns confirmed publication.
   */
  readonly save: (request: OfficeFileSaveRequest, signal: AbortSignal) => Promise<OfficeFileSaved>
}

/** Format-specific import and export, including all preservation and output validation. */
export interface OfficeDocumentCodec<Model> {
  /** The serialized format; Save As must preserve this extension. */
  readonly extension: 'docx' | 'xlsx' | 'pptx'
  /**
   * @param bytes - owned parser input; parsing must not mutate an active editor.
   * @param signal - cancellation.
   * @returns editable model.
   */
  readonly parse: (bytes: Uint8Array, signal: AbortSignal) => Promise<Model>
  /**
   * @param model - current editable model.
   * @returns an independent snapshot before asynchronous export starts.
   */
  readonly capture: (model: Model) => Model
  /**
   * Validate output before returning; a refusal must throw without publishing partial output.
   * @param model - fixed snapshot from capture.
   * @param baseline - borrowed original bytes and observed version; must not be changed or transferred.
   * @param signal - cancellation before file publication.
   * @returns complete validated bytes and the model to adopt when no subsequent edit has occurred.
   */
  readonly export: (model: Model, baseline: OfficeFileSnapshot, signal: AbortSignal) => Promise<{ bytes: Uint8Array; adopt: Model }>
  /**
   * Merge confirmed file metadata with any newer live edits; this operation must be synchronous and nonthrowing.
   * @param current - current live model, possibly newer than the exported snapshot.
   * @param published - model associated with the confirmed file bytes.
   * @param unchanged - whether no edits occurred after capture.
   * @returns the live model with its publication baseline refreshed.
   */
  readonly committed: (current: Model, published: Model, unchanged: boolean) => Model
}

/** Localized presentation selects copy from these stable reasons. */
export type OfficeDocumentFailure = 'conflict' | 'denied' | 'too-large' | 'validation' | 'failed' | 'busy' | 'cancelled' | 'unsaved'

/** Classified failure supplied by a format codec or the Remote adapter. */
export class OfficeDocumentError extends Error {
  /**
   * Create a lifetime with explicit storage and diagnostic owners.
   * @param reason - stable presentation reason.
   * @param options - private diagnostic cause.
   */
  constructor(readonly reason: OfficeDocumentFailure, options?: ErrorOptions) {
    super(reason, options)
  }
}

/** Transient presentation facts; editor models and source bytes are never persisted as layout state. */
export interface OfficeDocumentState {
  readonly path: string
  readonly phase: 'idle' | 'loading' | 'ready' | 'disposed'
  readonly dirty: boolean
  readonly saving: boolean
  readonly error: { readonly operation: 'load' | 'save'; readonly reason: OfficeDocumentFailure } | undefined
}

/** Explicit Save As intent, approved by the destination picker or overwrite decision. */
export interface OfficeSaveDestination {
  readonly path: string
  readonly expected: FsWriteIntent
}

interface Opened<Model> {
  model: Model
  baseline: OfficeFileSnapshot
  generation: number
  savedGeneration: number
}

/** One document lifetime, retained by the editor plugin while its tab occurrence exists. */
export class OfficeDocument<Model> {
  private readonly state
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<boolean>>()
  private opened: Opened<Model> | undefined
  private loading: AbortController | undefined
  private pendingSave: { readonly destination: OfficeSaveDestination; readonly promise: Promise<boolean> } | undefined
  private disposal: Promise<void> | undefined

  /**
   * Create a lifetime with explicit storage and diagnostic owners.
   * @param options - initial path, authorized file operations, format codec, and private diagnostic reporter.
   */
  constructor(private readonly options: {
    readonly path: string
    readonly files: OfficeDocumentFiles
    readonly codec: OfficeDocumentCodec<Model>
    readonly failed?: (error: unknown) => void
  }) {
    this.state = createSnapshotStore<OfficeDocumentState>({
      path: options.path, phase: 'idle', dirty: false, saving: false, error: undefined,
    })
  }

  /**
   * Read the current presentation without allocating a new snapshot.
   * @returns stable presentation snapshot until the next change.
   */
  getSnapshot = (): OfficeDocumentState => this.state.getSnapshot()
  /**
   * Observe presentation invalidation until the returned cleanup runs.
   * @param listener - state invalidation.
   * @returns subscription cleanup.
   */
  subscribe = (listener: () => void): (() => void) => this.state.subscribe(listener)
  /**
   * Read the live model owned by this document lifetime.
   * @returns the live format model, or absence before a successful open and after disposal.
   */
  model(): Model | undefined { return this.opened?.model }

  /**
   * Open or refresh a clean document; unsaved changes require an explicit discard operation.
   * @param signal - caller cancellation.
   * @returns whether a new source snapshot was adopted.
   */
  open(signal: AbortSignal): Promise<boolean> {
    if (this.getSnapshot().dirty) return this.refuse('load', 'unsaved')
    return this.load(signal)
  }

  /**
   * Reload after the owner has obtained the user's explicit discard decision.
   * @param signal - caller cancellation.
   * @returns whether the replacement loaded; a failure retains the previous model and dirty state.
   */
  reloadDiscardingChanges(signal: AbortSignal): Promise<boolean> { return this.load(signal) }

  /**
   * Adopt an engine edit and advance its generation even when the model reference is unchanged.
   * @param model - live model; capture must detach it before an export.
   */
  change(model: Model): void {
    if (this.lifetime.signal.aborted || this.opened === undefined) return
    this.loading?.abort()
    this.opened.model = model
    this.opened.generation += 1
    this.publish({ phase: 'ready', dirty: true, error: undefined })
  }

  /**
   * Save one captured edit generation against the current baseline version; overlapping identical saves share the operation.
   * @param signal - cancellation before publication; a confirmed successful response remains authoritative.
   * @returns confirmed publication, independently of whether subsequent edits remain dirty.
   */
  save(signal: AbortSignal): Promise<boolean> {
    if (this.opened === undefined) return this.refuse('save', 'failed')
    return this.write({ path: this.getSnapshot().path,
      expected: { kind: 'replaceIfVersion', version: this.opened.baseline.version } }, signal, false)
  }

  /**
   * Publish to an explicit new or version-approved target and switch identity only after confirmation.
   * @param destination - approved target and required intent.
   * @param signal - caller cancellation before publication.
   * @returns whether the copy was confirmed and adopted as the current source.
   */
  saveAs(destination: OfficeSaveDestination, signal: AbortSignal): Promise<boolean> { return this.write(destination, signal, true) }

  /**
   * Join admitted document operations without cancelling them.
   * @returns settlement of current reads and publications.
   */
  async whenIdle(): Promise<void> { await Promise.allSettled(this.operations) }

  /**
   * Cancel reads and exports, wait for possible publications, and release the editable model.
   * @returns completed cleanup.
   */
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      this.lifetime.abort()
      this.loading?.abort()
      this.publish({ phase: 'disposed', saving: false })
      await Promise.allSettled(this.operations)
      this.opened = undefined
    })()
  }

  private load(signal: AbortSignal): Promise<boolean> {
    if (this.lifetime.signal.aborted) return Promise.resolve(false)
    if (this.pendingSave !== undefined) return this.refuse('load', 'busy')
    this.loading?.abort()
    const load = new AbortController()
    this.loading = load
    const active = AbortSignal.any([signal, load.signal, this.lifetime.signal])
    const pending = Promise.resolve().then(async () => {
      try {
        active.throwIfAborted()
        const observed = await this.options.files.read(this.getSnapshot().path, active)
        const baseline = { ...observed, data: Uint8Array.from(observed.data) }
        const model = await this.options.codec.parse(Uint8Array.from(observed.data), active)
        active.throwIfAborted()
        this.opened = { model, baseline, generation: 0, savedGeneration: 0 }
        this.publish({ path: baseline.absolutePath, phase: 'ready', dirty: false, error: undefined })
        return true
      } catch (error) {
        if (this.loading === load && !this.lifetime.signal.aborted) {
          this.failure('load', error, active.aborted)
          this.publish({ phase: this.opened === undefined ? 'idle' : 'ready' })
        }
        return false
      } finally {
        if (this.loading === load) this.loading = undefined
        this.operations.delete(pending)
      }
    })
    this.operations.add(pending)
    this.publish({ phase: 'loading', error: undefined })
    return pending
  }

  private write(destination: OfficeSaveDestination, signal: AbortSignal, copy: boolean): Promise<boolean> {
    if (this.lifetime.signal.aborted) return Promise.resolve(false)
    const current = this.opened
    if (current === undefined) return this.refuse('save', 'failed')
    if (!destination.path.toLowerCase().endsWith(`.${this.options.codec.extension}`)) return this.refuse('save', 'validation')
    if (this.loading !== undefined) return this.refuse('save', 'busy')
    const previous = this.pendingSave
    if (previous !== undefined) {
      if (sameDestination(previous.destination, destination)) return previous.promise
      return this.refuse('save', 'busy')
    }
    if (!copy && current.generation === current.savedGeneration) return Promise.resolve(true)
    const active = AbortSignal.any([signal, this.lifetime.signal])
    let captured: Model
    try { active.throwIfAborted(); captured = this.options.codec.capture(current.model) } catch (error) {
      this.failure('save', error, active.aborted)
      return Promise.resolve(false)
    }
    const generation = current.generation
    const baseline = current.baseline
    const pending = Promise.resolve().then(async () => {
      try {
        active.throwIfAborted()
        const exported = await this.options.codec.export(captured, baseline, active)
        active.throwIfAborted()
        const saved = await this.options.files.save({
          ...destination, contentBase64: bytesToBase64(exported.bytes),
        }, active)
        if (this.lifetime.signal.aborted) return false
        current.baseline = { absolutePath: saved.absolutePath, version: saved.version,
          bytes: saved.bytes, data: Uint8Array.from(exported.bytes) }
        current.savedGeneration = generation
        current.model = this.options.codec.committed(current.model, exported.adopt, current.generation === generation)
        this.publish({ path: saved.absolutePath, dirty: current.generation !== generation, error: undefined })
        return true
      } catch (error) {
        if (!this.lifetime.signal.aborted) this.failure('save', error, active.aborted)
        return false
      } finally {
        this.pendingSave = undefined
        this.operations.delete(pending)
        if (!this.lifetime.signal.aborted) this.publish({ saving: false })
      }
    })
    this.pendingSave = { destination, promise: pending }
    this.operations.add(pending)
    this.publish({ saving: true, error: undefined })
    return pending
  }

  private publish(patch: Partial<OfficeDocumentState>): void { this.state.set({ ...this.getSnapshot(), ...patch }) }

  private refuse(operation: 'load' | 'save', reason: OfficeDocumentFailure): Promise<boolean> {
    if (!this.lifetime.signal.aborted) this.publish({ error: { operation, reason } })
    return Promise.resolve(false)
  }

  private failure(operation: 'load' | 'save', error: unknown, cancelled: boolean): void {
    const reason = cancelled ? 'cancelled' : error instanceof OfficeDocumentError ? error.reason : 'failed'
    this.publish({ error: { operation, reason } })
    if (!cancelled) this.options.failed?.(error)
  }
}

function sameDestination(left: OfficeSaveDestination, right: OfficeSaveDestination): boolean {
  if (left.path !== right.path) return false
  if (left.expected.kind === 'createIfAbsent') return right.expected.kind === 'createIfAbsent'
  return right.expected.kind === 'replaceIfVersion' && left.expected.version === right.expected.version
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  // Bound the argument list independently of document size.
  for (let offset = 0; offset < bytes.byteLength; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  }
  return btoa(parts.join(''))
}
