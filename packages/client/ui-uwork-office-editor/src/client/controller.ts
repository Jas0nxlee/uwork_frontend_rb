/** Owns Word editor engines and document operations across Sidebar body mounts. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { EditorMode, type Editor } from '@hufe921/canvas-editor'
import { OfficeDocument, type OfficeDocumentFailure, type OfficeDocumentFiles, type OfficeDocumentState } from './document.ts'
import { acceptWordLoss, wordCodec, type WordCodecOptions, type WordModel } from './word.ts'
import { createWordEditor } from './word-engine.ts'
import type { OfficeEngineQueue } from './engine-queue.ts'

/** Formatting actions available to the document viewport. */
export type WordCommand = 'undo' | 'redo' | 'bold' | 'italic' | 'underline'
/** User decision; cancellation keeps the existing document and editor. */
export type OfficeChoice = 'save' | 'discard' | 'cancel'
/** One body's plain presentation facts. */
export interface OfficeEntryState {
  readonly document: OfficeDocumentState
  readonly canEdit: boolean
  readonly busy: boolean
  readonly lossCount: number
  readonly trackChanges: boolean
  readonly prompt: 'close' | 'reload' | undefined
  readonly error: OfficeDocumentFailure | undefined
}

interface RecordEntry {
  readonly id: TabId
  readonly signal: AbortSignal
  readonly document: OfficeDocument<WordModel>
  readonly abort: AbortController
  readonly root: HTMLDivElement
  readonly unsubscribe: () => void
  readonly releaseAbort: () => void
  start: Promise<void>
  action: Promise<void> | undefined
  disposal: Promise<void> | undefined
  engine: Editor | undefined
  viewport: { readonly id: string } | undefined
  canEdit: boolean
  failure: OfficeDocumentFailure | undefined
  decision: { readonly kind: 'close' | 'reload'; readonly resolve: (choice: OfficeChoice) => void } | undefined
}

/** Per-Session editor lifetime and framework-bindable presentation source. */
export class OfficeController {
  private readonly state = createSnapshotStore<Readonly<Partial<Record<TabId, OfficeEntryState>>>>({})
  private readonly records = new Map<TabId, RecordEntry>()
  private readonly lifetime = new AbortController()
  private readonly disposals = new Set<Promise<void>>()

  /**
   * Create a lifetime with explicit storage and diagnostic owners.
   * @param options - authorized file calls, policy lookup, codec limits, and diagnostic owner.
   */
  constructor(private readonly options: {
    readonly files: (sessionId: SessionId) => OfficeDocumentFiles
    readonly canWrite: (sessionId: SessionId, signal: AbortSignal) => Promise<boolean>
    readonly word: WordCodecOptions
    readonly engineQueue: OfficeEngineQueue
    readonly failed: (error: unknown) => void
  }) {}

  /**
   * Read the current presentation without allocating a new snapshot.
   * @returns immutable tab presentation facts.
   */
  getSnapshot = (): Readonly<Partial<Record<TabId, OfficeEntryState>>> => this.state.getSnapshot()
  /**
   * Observe presentation invalidation until the returned cleanup runs.
   * @param listener - invalidation callback.
   * @returns subscription cleanup.
   */
  subscribe = (listener: () => void): (() => void) => this.state.subscribe(listener)

  /**
   * Attach a retained editor to its current body container and open its source once.
   * @param request - tab occurrence, file resource, and unique DOM viewport identity.
   * @returns attachment cleanup; document disposal follows the tab occurrence, not a body unmount.
   */
  mount(request: { tabId: TabId; address: string; viewportId: string; signal: AbortSignal }): () => void {
    if (request.signal.aborted || this.lifetime.signal.aborted) return () => {}
    let record = this.records.get(request.tabId)
    if (record === undefined || record.signal.aborted) {
      const file = parseFileAddress(request.address)
      if (file?.scope !== 'session') throw new Error('Office editor requires a Session file address')
      const sessionId = SessionId(file.sessionId)
      const abort = new AbortController()
      const signal = AbortSignal.any([request.signal, this.lifetime.signal, abort.signal])
      const document = new OfficeDocument({ path: file.path, files: this.options.files(sessionId),
        codec: wordCodec(this.options.word, this.options.engineQueue), failed: this.options.failed })
      const root = window.document.createElement('div')
      const dispose = (): void => { void this.remove(entry).catch(this.options.failed) }
      signal.addEventListener('abort', dispose, { once: true })
      const entry: RecordEntry = { id: request.tabId, signal, document, abort, root,
        unsubscribe: document.subscribe(() => { this.publish(entry) }),
        releaseAbort: () => { signal.removeEventListener('abort', dispose) },
        start: Promise.resolve(), action: undefined, disposal: undefined, engine: undefined,
        viewport: undefined, canEdit: false, failure: undefined, decision: undefined }
      this.records.set(request.tabId, entry)
      this.publish(entry)
      entry.start = (async () => {
        try {
          entry.canEdit = await this.options.canWrite(sessionId, signal)
          if (signal.aborted) return
          if (await document.open(signal)) this.attach(entry)
        } catch (error) { this.failed(entry, error) }
        this.publish(entry)
      })()
      record = entry
    }
    const attachment = { id: request.viewportId }
    record.viewport = attachment
    this.attach(record)
    return () => {
      if (record.viewport === attachment) { record.viewport = undefined; record.root.remove() }
    }
  }

  /**
   * Publish a captured snapshot through guarded file storage.
   * @param id - owning tab.
   * @returns completion of the requested save.
   */
  async save(id: TabId): Promise<void> {
    const record = this.records.get(id)
    if (record?.canEdit === true) await record.document.save(record.signal)
  }

  /**
   * Apply a formatting action to the writable active editor.
   * @param id - owning tab.
   * @param command - typed formatting action.
   */
  command(id: TabId, command: WordCommand): void {
    const record = this.records.get(id)
    const editor = record?.engine
    if (record?.canEdit !== true || editor === undefined || record.action !== undefined) return
    const commands: Record<WordCommand, () => void> = {
      undo: () => { editor.command.executeUndo() }, redo: () => { editor.command.executeRedo() },
      bold: () => { editor.command.executeBold() }, italic: () => { editor.command.executeItalic() },
      underline: () => { editor.command.executeUnderline() },
    }
    commands[command]()
  }

  /**
   * Record the revision-tracking preference as an unsaved document change.
   * @param id - owning tab.
   * @param enabled - whether subsequent edits are recorded as Word revisions.
   */
  tracking(id: TabId, enabled: boolean): void {
    const record = this.records.get(id)
    const model = record?.document.model()
    if (record?.canEdit === true && model !== undefined) record.document.change({ ...model, trackChanges: enabled })
  }

  /**
   * Resolve the decision displayed for this tab occurrence.
   * @param id - owning tab.
   * @param choice - user decision for the displayed modal.
   */
  choose(id: TabId, choice: OfficeChoice): void { this.records.get(id)?.decision?.resolve(choice) }

  /**
   * Import the converted document after the user accepts the reported loss.
   * @param id - owning tab.
   * @returns completion of an explicit import-loss decision.
   */
  async acceptLoss(id: TabId): Promise<void> {
    const record = this.records.get(id)
    const model = record?.document.model()
    if (record === undefined || !record.canEdit || model === undefined || record.action !== undefined) return
    record.action = Promise.resolve().then(async () => {
      try {
        const accepted = await acceptWordLoss(model, record.signal, this.options.engineQueue)
        record.signal.throwIfAborted()
        record.document.change(accepted)
        this.attach(record)
      } catch (error) { this.failed(record, error) }
    }).finally(() => { record.action = undefined; this.publish(record) })
    this.publish(record)
    await record.action
  }

  /**
   * Replace the editor only after resolving any unsaved edits.
   * @param id - owning tab.
   * @returns completion of a user-approved reload or its cancellation.
   */
  async reload(id: TabId): Promise<void> {
    const record = this.records.get(id)
    if (record === undefined || record.action !== undefined) return
    await record.document.whenIdle()
    if (record.document.getSnapshot().dirty) {
      const choice = await this.ask(record, 'reload', record.signal)
      if (choice === 'save') await record.document.save(record.signal)
      else if (choice !== 'discard') return
      if (choice === 'save' && record.document.getSnapshot().dirty) return
    }
    if (await record.document.reloadDiscardingChanges(record.signal)) {
      record.engine?.destroy()
      record.engine = undefined
      record.root.replaceChildren()
      record.failure = undefined
      this.attach(record)
      this.publish(record)
    }
  }

  /**
   * Resolve unsaved edits before allowing this tab occurrence to close.
   * @param id - tab being closed.
   * @param signal - withdrawn close request.
   * @returns permission to remove its occurrence.
   */
  async prepareClose(id: TabId, signal: AbortSignal): Promise<boolean> {
    const record = this.records.get(id)
    if (record === undefined) return true
    await record.action
    await record.document.whenIdle()
    if (signal.aborted || record.signal.aborted) return false
    if (!record.document.getSnapshot().dirty) return true
    const choice = await this.ask(record, 'close', signal)
    if (choice === 'discard') return !signal.aborted
    if (choice !== 'save') return false
    await record.document.save(record.signal)
    return !AbortSignal.any([signal, record.signal]).aborted && !record.document.getSnapshot().dirty
  }

  /**
   * Release every engine only after its document and import operations settle.
   * @returns completed cleanup.
   */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    for (const record of this.records.values()) void this.remove(record).catch(this.options.failed)
    const settled = await Promise.allSettled(this.disposals)
    const failures = settled.filter(result => result.status === 'rejected').map((result): unknown => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'Office editor cleanup failed')
  }

  private attach(record: RecordEntry): void {
    try { this.attachEditor(record) } catch (error) { this.failed(record, error) }
  }

  private attachEditor(record: RecordEntry): void {
    if (record.signal.aborted || record.viewport === undefined) return
    const viewport = document.getElementById(record.viewport.id)
    if (viewport === null) throw new Error('Office viewport is not mounted')
    const model = record.document.model()
    if (model?.snapshot === undefined) return
    if (record.engine === undefined) {
      const editor = createWordEditor(record.root, model.snapshot(), `#${CSS.escape(record.viewport.id)}`)
      record.engine = editor
      if (!record.canEdit) editor.command.executeMode(EditorMode.READONLY)
      editor.listener.contentChange = () => {
        const current = record.document.model()
        if (current !== undefined && record.canEdit) {
          record.document.change({ ...current, snapshot: () => ({ value: editor.command.getValue() }) })
        }
      }
    }
    viewport.append(record.root)
  }

  private ask(record: RecordEntry, kind: 'close' | 'reload', signal: AbortSignal): Promise<OfficeChoice> {
    if (signal.aborted || record.signal.aborted || record.decision !== undefined) return Promise.resolve('cancel')
    return new Promise<OfficeChoice>((resolve) => {
      const active = AbortSignal.any([signal, record.signal])
      const finish = (choice: OfficeChoice): void => {
        active.removeEventListener('abort', cancel)
        record.decision = undefined
        this.publish(record)
        resolve(choice)
      }
      const cancel = (): void => { finish('cancel') }
      active.addEventListener('abort', cancel, { once: true })
      record.decision = { kind, resolve: finish }
      this.publish(record)
    })
  }

  private remove(record: RecordEntry): Promise<void> {
    if (record.disposal !== undefined) return record.disposal
    const pending = Promise.resolve().then(async () => {
      record.abort.abort()
      record.releaseAbort()
      record.decision?.resolve('cancel')
      record.unsubscribe()
      await record.document.dispose()
      await Promise.allSettled([record.start, record.action])
      try { record.engine?.destroy() } finally {
        record.root.remove()
        if (this.records.get(record.id) === record) {
          this.records.delete(record.id)
          const { [record.id]: removed, ...snapshot } = this.getSnapshot()
          void removed
          this.state.set(snapshot)
        }
        this.disposals.delete(pending)
      }
    })
    record.disposal = pending
    this.disposals.add(pending)
    return pending
  }

  private publish(record: RecordEntry): void {
    if (record.signal.aborted || this.records.get(record.id) !== record) return
    const model = record.document.model()
    const state: OfficeEntryState = { document: record.document.getSnapshot(), canEdit: record.canEdit && record.failure === undefined,
      busy: record.action !== undefined,
      lossCount: model?.acceptedLoss === false ? model.warnings.reduce((sum, item) => sum + item.count, 0) : 0,
      trackChanges: model?.trackChanges ?? false, prompt: record.decision?.kind,
      error: record.failure ?? record.document.getSnapshot().error?.reason }
    this.state.set({ ...this.getSnapshot(), [record.id]: state })
  }

  private failed(record: RecordEntry, error: unknown): void {
    if (record.signal.aborted) return
    record.failure = 'failed'
    this.options.failed(error)
    this.publish(record)
  }
}
