/** Apache-2.0; adapted UWork DOCX handling. Original license and revision are retained in licenses/UWork.notice.txt. */
import JSZip from 'jszip'
import { WORD, isWord, wordDescendants, decodeXmlText, parseXml, serializeXml } from './xml.ts'
/** DOCX revision_colors. */
export const REVISION_COLORS = {
  insert: '1A73E8',
  delete: 'D93025',
  comment: 'B45309',
} as const
/** DOCX paragraph preservation. */
export interface ParagraphPreservation {
  index: number
  originalXml: string
  displayText: string
  acceptedText: string
  inserted: number
  deleted: number
  comments: number
}
/** DOCX revision view. */
export interface RevisionView {
  xml: string
  comments: DocumentComment[]
  paragraphs: ParagraphPreservation[]
  summary: {
    inserted: number
    deleted: number
    comments: number
  }
  commentMarks: Array<{
    index: number
    paragraph: number
    around: string
  }>
}
/** DOCX paragraph_pattern. */
export const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
function paragraphText(paragraphXml: string): string {
  let text = ''
  for (const match of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    text += decodeXmlText(match[1] ?? '')
  }
  return text
}
function addRunProperties(runXml: string, properties: string): string {
  if (/<w:rPr>/.test(runXml)) {
    return runXml.replace('<w:rPr>', `<w:rPr>${properties}`)
  }
  return runXml.replace(/^(<w:r(?:\s[^>]*)?>)/, `$1<w:rPr>${properties}</w:rPr>`)
}
function styleInsertedXml(inner: string): string {
  return inner.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, run => addRunProperties(run, `<w:u w:val="single"/><w:color w:val="${REVISION_COLORS.insert}"/>`))
}
function styleDeletedXml(inner: string): string {
  return inner
    .replace(/<w:delText(\s[^>]*)?>/g, '<w:t$1>')
    .replace(/<\/w:delText>/g, '</w:t>')
    .replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, run => addRunProperties(run, `<w:strike/><w:color w:val="${REVISION_COLORS.delete}"/>`))
}
/**
 * Produce editable revision markers and preserve original reviewed paragraphs.
 * @param documentXml - main document XML.
 * @param commentContents - comment metadata indexed by document id.
 * @returns the transformed document data and operation metadata.
 */
export function buildRevisionView(documentXml: string, commentContents: Map<string, {
  author: string
  date: string
  text: string
}> = new Map()): RevisionView {
  const paragraphs: ParagraphPreservation[] = []
  const comments: DocumentComment[] = []
  const commentMarks: RevisionView['commentMarks'] = []
  let commentIndex = 0
  const summary = { inserted: 0, deleted: 0, comments: 0 }
  let paragraphIndex = 0
  const rewritten = documentXml.replace(PARAGRAPH_PATTERN, (paragraphXml) => {
    const hasRevisions = /<w:ins[ >]/.test(paragraphXml) ||
            /<w:(?:del|moveFrom|moveTo)[ >]/.test(paragraphXml) ||
            /<w:commentReference[ >]/.test(paragraphXml)
    const current = paragraphIndex
    paragraphIndex += 1
    if (!hasRevisions)
      return paragraphXml
    const inserted = (paragraphXml.match(/<w:ins[ >]/g) ?? []).length
    const deleted = (paragraphXml.match(/<w:(?:del|moveFrom)[ >]/g) ?? []).length
    let next = paragraphXml
      .replace(/<w:ins(?:\s[^>]*)?>([\s\S]*?)<\/w:ins>/g, (_m, inner: string) => styleInsertedXml(inner))
      .replace(/<w:moveTo(?:\s[^>]*)?>([\s\S]*?)<\/w:moveTo>/g, (_m, inner: string) => styleInsertedXml(inner))
      .replace(/<w:del(?:\s[^>]*)?>([\s\S]*?)<\/w:del>/g, (_m, inner: string) => styleDeletedXml(inner))
      .replace(/<w:moveFrom(?:\s[^>]*)?>([\s\S]*?)<\/w:moveFrom>/g, (_m, inner: string) => styleDeletedXml(inner))
    let commentsInParagraph = 0
    const rangeIds = [...paragraphXml.matchAll(/<w:commentRangeStart[^>]*w:id="([^"]*)"/g)].map(match => match[1])
    for (const id of rangeIds) {
      commentIndex += 1
      commentsInParagraph += 1
      const start = next.indexOf(`w:commentRangeStart w:id="${id}"`)
      const end = next.indexOf(`w:commentRangeEnd w:id="${id}"`)
      const anchorText = start >= 0 && end > start
        ? paragraphText(next.slice(next.indexOf('>', start) + 1, next.lastIndexOf('<', end)))
        : ''
      const content = commentContents.get(id ?? '')
      comments.push({
        index: commentIndex,
        id: id ?? '',
        author: content?.author ?? '',
        date: content?.date ?? '',
        text: content?.text ?? '',
        paragraph: current,
        anchorText,
      })
      commentMarks.push({
        index: commentIndex,
        paragraph: current,
        around: anchorText.slice(0, 20),
      })
    }
    if (rangeIds.length > 0) {
      next = next.replace(/(<w:commentRangeStart[^>]*>[\s\S]*?<w:commentRangeEnd[^>]*>)/g, block => block.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, run => addRunProperties(run, '<w:shd w:val="clear" w:color="auto" w:fill="FFF7D6"/>')))
    }
    summary.inserted += inserted
    summary.deleted += deleted
    summary.comments += commentsInParagraph
    paragraphs.push({
      index: current,
      originalXml: paragraphXml,
      displayText: paragraphText(next),
      acceptedText: paragraphText(paragraphXml.replace(/<w:(del|moveFrom)(?:\s[^>]*)?>[\s\S]*?<\/w:\1>/g, '')),
      inserted,
      deleted,
      comments: commentsInParagraph,
    })
    return next
  })
  return { xml: rewritten, paragraphs, summary, commentMarks, comments }
}
/**
 * Restore unchanged reviewed paragraphs from their original XML.
 * @param exportedXml - editor-exported main document XML.
 * @param paragraphs - retained original reviewed paragraphs.
 * @returns the transformed document data and operation metadata.
 */
export function restoreOriginalParagraphs(exportedXml: string, paragraphs: ParagraphPreservation[]): {
  xml: string
  restored: number
  edited: number
} {
  const byIndex = new Map(paragraphs.map(entry => [entry.index, entry]))
  let index = 0
  let restored = 0
  let edited = 0
  const xml = exportedXml.replace(PARAGRAPH_PATTERN, (paragraphXml) => {
    const entry = byIndex.get(index)
    index += 1
    if (!entry)
      return paragraphXml
    const text = paragraphText(paragraphXml)
    if (text === entry.displayText || text === entry.acceptedText) {
      restored += 1
      return entry.originalXml
    }
    edited += 1
    return paragraphXml
  })
  return { xml, restored, edited }
}
/** DOCX document comment. */
export interface DocumentComment {
  index: number
  id: string
  author: string
  date: string
  text: string
  paragraph: number
  anchorText: string
}
/** DOCX revision preservation state. */
export interface RevisionPreservationState {
  paragraphs: ParagraphPreservation[]
  comments: DocumentComment[]
  namespaces: { readonly name: string; readonly uri: string }[]
}
/**
 * Read Word comment metadata without changing document content.
 * @param zip - opened DOCX archive.
 * @returns the transformed document data and operation metadata.
 */
export async function readComments(zip: {
  file: (path: string) => {
    async: (type: 'string') => Promise<string>
  } | null
}): Promise<Map<string, {
  author: string
  date: string
  text: string
}>> {
  const entry = zip.file('word/comments.xml')
  if (!entry)
    return new Map()
  const xml = await entry.async('string')
  const map = new Map<string, {
    author: string
    date: string
    text: string
  }>()
  for (const match of xml.matchAll(/<w:comment(?:\s[^>]*)?>([\s\S]*?)<\/w:comment>/g)) {
    const whole = match[0]
    const id = /w:id="([^"]*)"/.exec(whole)?.[1] ?? ''
    const author = /w:author="([^"]*)"/.exec(whole)?.[1] ?? ''
    const date = /w:date="([^"]*)"/.exec(whole)?.[1] ?? ''
    let text = ''
    for (const run of (match[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
      text += decodeXmlText(run[1] ?? '')
    map.set(id, { author, date, text })
  }
  return map
}
/**
 * Produce the editable reviewed view of a complete DOCX.
 * @param bytes - complete DOCX bytes.
 * @returns the transformed document data and operation metadata.
 */
export async function applyRevisionView(bytes: ArrayBuffer): Promise<{
  bytes: ArrayBuffer
  preservation: RevisionPreservationState
  summary: RevisionView['summary']
  comments: DocumentComment[]
}> {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file('word/document.xml')
  if (!entry)
    return {
      bytes,
      preservation: { paragraphs: [], comments: [], namespaces: [] },
      summary: { inserted: 0, deleted: 0, comments: 0 },
      comments: [],
    }
  const commentContents = await readComments(zip)
  const view = buildRevisionView(await entry.async('string'), commentContents)
  if (view.paragraphs.length === 0) {
    return {
      bytes,
      preservation: { paragraphs: [], comments: [], namespaces: [] },
      summary: view.summary,
      comments: [],
    }
  }
  zip.file('word/document.xml', view.xml)
  return {
    bytes: await zip.generateAsync({ type: 'arraybuffer' }),
    preservation: {
      paragraphs: view.paragraphs, comments: view.comments,
      namespaces: [...parseXml(view.xml).documentElement.attributes]
        .filter(attribute => attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/')
        .map(attribute => ({ name: attribute.name, uri: attribute.value })),
    },
    summary: view.summary,
    comments: view.comments,
  }
}
/**
 * Restore unchanged reviewed paragraphs and their namespace declarations after editor export.
 * @param bytes - complete DOCX bytes.
 * @param preservation - original revision and comment records.
 * @returns the transformed document data and operation metadata.
 */
export async function restoreRevisions(bytes: ArrayBuffer, preservation: RevisionPreservationState): Promise<{
  bytes: ArrayBuffer
  restored: number
  edited: number
}> {
  if (preservation.paragraphs.length === 0)
    return { bytes, restored: 0, edited: 0 }
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file('word/document.xml')
  if (!entry)
    return { bytes, restored: 0, edited: 0 }
  const document = parseXml(await entry.async('string'))
  for (const namespace of preservation.namespaces) {
    const previous = document.documentElement.getAttribute(namespace.name)
    if (previous !== null && previous !== namespace.uri) throw new Error('Conflicting retained document namespace')
    document.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', namespace.name, namespace.uri)
  }
  const result = restoreOriginalParagraphs(serializeXml(document), preservation.paragraphs)
  zip.file('word/document.xml', result.xml)
  return {
    bytes: await zip.generateAsync({ type: 'arraybuffer' }),
    restored: result.restored,
    edited: result.edited,
  }
}
function removeCommentNodes(root: Document, targets: ReadonlySet<string>): number {
  const removed = new Set<string>()
  for (const name of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) {
    for (const node of wordDescendants(root, name)) {
      const id = node.getAttributeNS(WORD, 'id')
      if (id === null || !targets.has(id)) continue
      const run = node.parentElement
      node.remove()
      removed.add(id)
      if (name === 'commentReference' && run !== null && isWord(run, 'r')
        && [...run.children].every(child => isWord(child, 'rPr'))) run.remove()
    }
  }
  return removed.size
}

/**
 * Remove selected comment anchors without removing body text.
 * @param documentXml - main document XML.
 * @param ids - comment ids selected for removal.
 * @returns the transformed document data and operation metadata.
 */
export function removeCommentMarkup(documentXml: string, ids: Iterable<string>): {
  xml: string
  removed: number
} {
  const document = parseXml(documentXml)
  const removed = removeCommentNodes(document, new Set(ids))
  return { xml: removed === 0 ? documentXml : serializeXml(document), removed }
}
/**
 * Remove selected comment anchors from an archive.
 * @param bytes - complete DOCX bytes.
 * @param ids - comment ids selected for removal.
 * @returns the transformed document data and operation metadata.
 */
export async function removeCommentAnchorsInDocx(bytes: ArrayBuffer, ids: Iterable<string>): Promise<{
  bytes: ArrayBuffer
  removed: number
}> {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file('word/document.xml')
  if (!entry)
    return { bytes, removed: 0 }
  const result = removeCommentMarkup(await entry.async('string'), ids)
  if (result.removed === 0)
    return { bytes, removed: 0 }
  zip.file('word/document.xml', result.xml)
  return { bytes: await zip.generateAsync({ type: 'arraybuffer' }), removed: result.removed }
}
/**
 * Remove deleted comment anchors from retained paragraph originals.
 * @param preservation - original revision and comment records.
 * @param ids - comment ids selected for removal.
 * @returns the transformed document data and operation metadata.
 */
export function stripCommentsFromPreservation(preservation: RevisionPreservationState, ids: Iterable<string>): RevisionPreservationState {
  const targets = new Set(ids)
  return {
    namespaces: preservation.namespaces,
    comments: preservation.comments.filter(comment => !targets.has(comment.id)),
    paragraphs: preservation.paragraphs.map((paragraph) => {
      const hasTarget = preservation.comments.some(comment => targets.has(comment.id) && comment.paragraph === paragraph.index)
      if (!hasTarget)
        return paragraph
      const fragment = parseXml(`<office-fragment xmlns:w="${WORD}"/>`)
      for (const namespace of preservation.namespaces) {
        fragment.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', namespace.name, namespace.uri)
      }
      fragment.documentElement.innerHTML = paragraph.originalXml
      removeCommentNodes(fragment, targets)
      const stripped = [...fragment.documentElement.childNodes].map(serializeXml).join('')
      return { ...paragraph, originalXml: stripped, comments: wordDescendants(fragment, 'commentReference').length }
    }),
  }
}
