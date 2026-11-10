/** Isolated canvas-editor imports and snapshot exports; active editors are never borrowed for asynchronous serialization. */
import { Editor, EditorMode, PageMode, type IEditorData, type IEditorOption, type IEditorResult } from '@hufe921/canvas-editor'
import docxPlugin from '@hufe921/canvas-editor-plugin-docx'
import clsx from 'clsx'
import css from './Office.module.css'

/** Fixed editor data and document options captured before export. */
export interface WordSnapshot {
  readonly value: IEditorResult
}

/**
 * Parse DOCX through a temporary editor without mutating any visible editor.
 * @param bytes - admitted complete import bytes.
 * @param signal - document-operation cancellation.
 * @returns an independent editor snapshot after import completes.
 */
export function importWord(bytes: ArrayBuffer, signal: AbortSignal): Promise<WordSnapshot> {
  return temporaryWord({ main: [{ value: '' }] }, {}, signal, async (editor) => {
    // The package declares void, while its implementation returns an import Promise.
    const importDocx: (options: Parameters<typeof editor.command.executeImportDocx>[0]) => void | Promise<void> =
      editor.command.executeImportDocx.bind(editor.command)
    await Promise.resolve(importDocx({ arrayBuffer: bytes }))
    return { value: structuredClone(editor.command.getValue()) }
  })
}

/**
 * Export the captured data in its own editor, leaving ongoing user edits untouched.
 * @param snapshot - independent data captured synchronously at Save.
 * @param signal - document-operation cancellation.
 * @returns complete serialized DOCX bytes; preservation and validation run afterwards.
 */
export function exportWord(snapshot: WordSnapshot, signal: AbortSignal): Promise<ArrayBuffer> {
  return temporaryWord(snapshot.value.data, snapshot.value.options, signal, async (editor) => {
    const blob = await editor.command.executeExportDocx({ fileName: 'document.docx' })
    return blob.arrayBuffer()
  })
}

/**
 * Construct one visible editor from imported data; the caller owns destruction after document operations drain.
 * @param host - plugin-owned viewport element.
 * @param snapshot - imported editor data and document options.
 * @param scrollContainerSelector - unique selector for this viewport's scroll container.
 * @returns the format engine owned by the viewport controller.
 */
export function createWordEditor(host: HTMLDivElement, snapshot: WordSnapshot, scrollContainerSelector: string): Editor {
  const editor = new Editor(host, snapshot.value.data, {
    ...snapshot.value.options, scrollContainerSelector, mode: EditorMode.EDIT, pageMode: PageMode.PAGING,
  })
  try {
    editor.use(docxPlugin)
    return editor
  } catch (error) {
    editor.destroy()
    throw error
  }
}

async function temporaryWord<T>(
  data: IEditorData, options: IEditorOption, signal: AbortSignal, operation: (editor: Editor) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  const host = document.createElement('div')
  host.className = clsx(css.temporary)
  document.body.append(host)
  let editor: Editor | undefined
  try {
    editor = new Editor(host, data, { ...options, mode: EditorMode.READONLY, pageMode: PageMode.PAGING })
    editor.use(docxPlugin)
    const result = await operation(editor)
    signal.throwIfAborted()
    return result
  } finally {
    try { editor?.destroy() } finally { host.remove() }
  }
}
