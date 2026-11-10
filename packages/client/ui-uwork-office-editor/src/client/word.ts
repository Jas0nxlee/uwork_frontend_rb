/** DOCX lifecycle codec combining the imported UWork review pipeline and isolated editor snapshots. */
import type { OfficeDocumentCodec } from './document.ts'
import { OfficeDocumentError } from './document.ts'
import { importWord, exportWord, type WordSnapshot } from './word-engine.ts'
import { preprocessDocx, summarizeFindings, type DocxPreflightResult, type LossyFinding } from './formats/docx/docxPreflight.ts'
import { applyRevisionView, restoreRevisions, type RevisionPreservationState } from './formats/docx/docxRevisions.ts'
import { applyTrackedChanges } from './formats/docx/docxTrackChanges.ts'
import { preserveWordMetadata } from './formats/docx/docxPreservation.ts'
import { validateDocxCandidate } from './formats/docx/docxValidate.ts'
import type { OfficeEngineQueue } from './engine-queue.ts'

/** Import decisions and editable engine data; the getter may read a live viewport until capture detaches it. */
export interface WordModel {
  readonly snapshot: (() => WordSnapshot) | undefined
  readonly importBytes: ArrayBuffer
  readonly reviewSource: ArrayBuffer
  readonly preflight: DocxPreflightResult
  readonly warnings: readonly LossyFinding[]
  readonly preservation: RevisionPreservationState
  readonly trackChanges: boolean
  readonly acceptedLoss: boolean
}

/** Deployment limits and the identity used for new tracked changes. */
export interface WordCodecOptions {
  readonly maxDocumentXmlBytes: number
  readonly minRetainedTextRatio: number
  readonly author: string
  /**
   * @returns a timestamp captured when serializing the fixed model.
   */
  readonly now: () => string
}

/**
 * Build a per-document codec; raw bytes and preservation state remain owned by its document lifetime.
 * @param options - deployment limits and revision identity.
 * @param engines - serialized SDK access shared across this plugin's documents.
 * @returns importer, fixed-snapshot capture, and validated export operations.
 */
export function wordCodec(options: WordCodecOptions, engines: OfficeEngineQueue): OfficeDocumentCodec<WordModel> {
  return {
    extension: 'docx',
    parse: async (bytes, signal) => {
      signal.throwIfAborted()
      const raw = Uint8Array.from(bytes).buffer
      const validated = await validateDocxCandidate(raw, null, options.minRetainedTextRatio)
      if (!validated.ok) throw new OfficeDocumentError('validation')
      const preflight = await preprocessDocx(raw)
      if (preflight.findings.documentXmlBytes > options.maxDocumentXmlBytes) throw new OfficeDocumentError('too-large')
      const view = await applyRevisionView(preflight.bytes)
      const warnings = summarizeFindings(preflight.findings)
      const snapshot = warnings.length === 0 ? await engines.run(() => importWord(view.bytes, signal), signal) : undefined
      return { snapshot: snapshot === undefined ? undefined : () => snapshot,
        importBytes: view.bytes, reviewSource: preflight.bytes, preflight, warnings, preservation: view.preservation,
        trackChanges: true, acceptedLoss: warnings.length === 0 }
    },
    capture: (model) => {
      if (model.snapshot === undefined) throw new OfficeDocumentError('validation')
      const snapshot = structuredClone(model.snapshot())
      return { ...model, snapshot: () => snapshot }
    },
    export: async (model, _baseline, signal) => {
      if (!model.acceptedLoss || model.snapshot === undefined) throw new OfficeDocumentError('validation')
      const snapshot = model.snapshot()
      let bytes = await engines.run(() => exportWord(snapshot, signal), signal)
      const source = model.reviewSource
      if (model.trackChanges) {
        bytes = (await applyTrackedChanges(source, bytes, { author: options.author, date: options.now() })).bytes
      }
      bytes = (await restoreRevisions(bytes, model.preservation)).bytes
      bytes = (await preserveWordMetadata(source, bytes)).bytes
      const validated = await validateDocxCandidate(bytes, source, options.minRetainedTextRatio)
      if (!validated.ok) throw new OfficeDocumentError('validation')
      const preflight = await preprocessDocx(bytes)
      if (preflight.findings.documentXmlBytes > options.maxDocumentXmlBytes) throw new OfficeDocumentError('too-large')
      const view = await applyRevisionView(preflight.bytes)
      signal.throwIfAborted()
      return { bytes: new Uint8Array(bytes), adopt: { ...model, preflight, reviewSource: bytes,
        importBytes: view.bytes, preservation: view.preservation } }
    },
    committed: (current, published, unchanged) => ({ ...published,
      snapshot: unchanged ? published.snapshot : current.snapshot,
      trackChanges: current.trackChanges, acceptedLoss: current.acceptedLoss }),
  }
}

/**
 * Import a document only after its potentially lossy conversion has been explicitly accepted.
 * @param model - blocked import and its reported feature findings.
 * @param signal - document lifetime cancellation.
 * @param engines - serialized SDK access shared across this plugin's documents.
 * @returns imported model; its owner records this decision as an unsaved change.
 */
export async function acceptWordLoss(model: WordModel, signal: AbortSignal, engines: OfficeEngineQueue): Promise<WordModel> {
  const snapshot = await engines.run(() => importWord(model.importBytes, signal), signal)
  return { ...model, snapshot: () => snapshot, acceptedLoss: true }
}
