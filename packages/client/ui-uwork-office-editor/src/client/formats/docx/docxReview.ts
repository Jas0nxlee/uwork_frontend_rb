/** Apache-2.0; adapted UWork DOCX handling. Original license and revision are retained in licenses/UWork.notice.txt. */
import JSZip from 'jszip'
import { decodeXmlText } from './xml.ts'
import { PARAGRAPH_PATTERN } from './docxRevisions.ts'
/** DOCX revision kind. */
export type RevisionKind = 'insert' | 'delete'
/** DOCX revision item. */
export interface RevisionItem {
  index: number
  kind: RevisionKind
  text: string
  author: string
  paragraph: number
}
/** DOCX revision action. */
export type RevisionAction = 'accept' | 'reject'
/**
 * List main-document insertion and deletion records in document order.
 * @param documentXml - main document XML.
 * @returns the transformed document data and operation metadata.
 */
export function listRevisions(documentXml: string): RevisionItem[] {
  const items: RevisionItem[] = []
  let paragraph = 0
  for (const match of documentXml.matchAll(PARAGRAPH_PATTERN)) {
    const paragraphXml = match[0]
    for (const revision of paragraphXml.matchAll(/<w:(ins|del|moveTo|moveFrom)(?:\s[^>]*)?>([\s\S]*?)<\/w:\1>/g)) {
      const tag = revision[1]
      const inner = revision[2] ?? ''
      const author = decodeXmlText(/w:author="([^"]*)"/.exec(revision[0])?.[1] ?? '')
      let text = ''
      for (const run of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
        text += decodeXmlText(run[1] ?? '')
      for (const run of inner.matchAll(/<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/g))
        text += decodeXmlText(run[1] ?? '')
      items.push({
        index: items.length,
        kind: tag === 'ins' || tag === 'moveTo' ? 'insert' : 'delete',
        text,
        author,
        paragraph,
      })
    }
    paragraph += 1
  }
  return items
}
/** DOCX resolve revisions options. */
export interface ResolveRevisionsOptions {
  action: RevisionAction
  targetIndex?: number
}
/** DOCX resolve revisions result. */
export interface ResolveRevisionsResult {
  xml: string
  resolved: number
  remaining: RevisionItem[]
  handled: RevisionItem[]
}
/**
 * Accept or reject selected main-document revisions.
 * @param documentXml - main document XML.
 * @param options - explicit operation options.
 * @returns the transformed document data and operation metadata.
 */
export function resolveRevisions(documentXml: string, options: ResolveRevisionsOptions): ResolveRevisionsResult {
  const targets = listRevisions(documentXml)
  const wants = (item: RevisionItem) => options.targetIndex === undefined ? true : item.index === options.targetIndex
  const handled = targets.filter(wants)
  if (handled.length === 0)
    return { xml: documentXml, resolved: 0, remaining: targets, handled: [] }
  const accept = options.action === 'accept'
  const unwrapKinds = new Set<RevisionKind>()
  const dropKinds = new Set<RevisionKind>()
  if (accept) {
    unwrapKinds.add('insert')
    dropKinds.add('delete')
  }
  else {
    dropKinds.add('insert')
    unwrapKinds.add('delete')
  }
  let seen = 0
  const xml = documentXml.replace(/<w:(ins|del|moveTo|moveFrom)(?:\s[^>]*)?>[\s\S]*?<\/w:\1>/g, (whole) => {
    const item = targets[seen]
    seen += 1
    if (!item || !wants(item))
      return whole
    if (unwrapKinds.has(item.kind)) {
      const inner = whole
        .replace(/^<w:(?:ins|moveTo|del|moveFrom)(?:\s[^>]*)?>/, '')
        .replace(/<\/w:(?:ins|moveTo|del|moveFrom)>$/, '')
        .replace(/<w:delText(\s[^>]*)?>/g, '<w:t$1>')
        .replace(/<\/w:delText>/g, '</w:t>')
      return inner
    }
    if (dropKinds.has(item.kind))
      return ''
    return whole
  })
  return {
    xml,
    resolved: handled.length,
    remaining: targets.filter(item => !wants(item)),
    handled,
  }
}
/**
 * Apply revision decisions to a complete DOCX archive.
 * @param bytes - complete DOCX bytes.
 * @param options - explicit operation options.
 * @returns the transformed document data and operation metadata.
 */
export async function resolveRevisionsInDocx(bytes: ArrayBuffer, options: ResolveRevisionsOptions): Promise<{
  bytes: ArrayBuffer
} & Omit<ResolveRevisionsResult, 'xml'>> {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file('word/document.xml')
  if (!entry)
    return { bytes, resolved: 0, remaining: [], handled: [] }
  const result = resolveRevisions(await entry.async('string'), options)
  zip.file('word/document.xml', result.xml)
  return {
    bytes: await zip.generateAsync({ type: 'arraybuffer' }),
    resolved: result.resolved,
    remaining: result.remaining,
    handled: result.handled,
  }
}
