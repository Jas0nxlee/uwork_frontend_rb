/** Apache-2.0; adapted UWork DOCX handling. Original license and revision are retained in licenses/UWork.notice.txt. */
import JSZip from 'jszip'
import { OFFICE_RELS, PACKAGE_RELS, WORD, parseXml, wordDescendants } from './xml.ts'
/** DOCX docx validation issue. */
export interface DocxValidationIssue {
  code: 'not-a-zip' | 'missing-part' | 'invalid-xml' | 'dangling-relationship' | 'dangling-comment' | 'content-collapsed' | 'invalid-source'
  part?: string
  relationshipIds?: string[]
  beforeCharacters?: number
  afterCharacters?: number
}
/** DOCX docx validation result. */
export interface DocxValidationResult {
  ok: boolean
  issues: DocxValidationIssue[]
  textLength: number
}
function visibleText(documentXml: string): string {
  const withoutDeleted = documentXml.replace(/<w:del(?:\s[^>]*)?>[\s\S]*?<\/w:del>/g, '')
  let text = ''
  for (const match of withoutDeleted.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
    text += match[1] ?? ''
  return text
}
function relationshipIds(xml: string): Set<string> {
  const ids = new Set<string>()
  for (const match of xml.matchAll(/<Relationship[^>]*Id="([^"]+)"/g))
    ids.add(match[1] ?? '')
  return ids
}
function referencedRelationshipIds(documentXml: string): Set<string> {
  const ids = new Set<string>()
  for (const match of documentXml.matchAll(/r:(?:id|embed|link)="([^"]+)"/g))
    ids.add(match[1] ?? '')
  return ids
}
const REQUIRED_PARTS = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
function parseXmlOrIssue(name: string, content: string, issues: DocxValidationIssue[]): boolean {
  const parsed = new DOMParser().parseFromString(content, 'application/xml')
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    issues.push({ code: 'invalid-xml', part: name })
    return false
  }
  return true
}

async function validateComments(zip: JSZip, main: Document, issues: DocxValidationIssue[]): Promise<void> {
  const ids = new Set(['commentRangeStart', 'commentRangeEnd', 'commentReference']
    .flatMap(name => wordDescendants(main, name)).map(node => node.getAttributeNS(WORD, 'id')))
  if (ids.size === 0) return
  const rels = zip.file('word/_rels/document.xml.rels')
  const relation = rels === null ? undefined
    : [...parseXml(await rels.async('string')).getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')]
      .find(node => node.getAttribute('Type') === `${OFFICE_RELS}/comments`)
  const target = relation?.getAttribute('Target')
  if (target === undefined || target === null || target === '' || relation?.getAttribute('TargetMode') === 'External') {
    issues.push({ code: 'dangling-comment', part: 'word/_rels/document.xml.rels' })
    return
  }
  if (!URL.canParse(target, 'https://ooxml.invalid/word/document.xml')) {
    issues.push({ code: 'dangling-comment', part: target })
    return
  }
  const url = new URL(target, 'https://ooxml.invalid/word/document.xml')
  const comments = url.origin === 'https://ooxml.invalid' && url.hash === '' && url.search === ''
    ? zip.file(url.pathname.slice(1)) : null
  if (comments === null) {
    issues.push({ code: 'dangling-comment', part: target })
    return
  }
  const records = new Set(wordDescendants(parseXml(await comments.async('string')), 'comment')
    .map(node => node.getAttributeNS(WORD, 'id')))
  if ([...ids].some(id => id === null || !records.has(id))) issues.push({ code: 'dangling-comment', part: target })
}
/**
 * Validate required parts, XML, relationships, and accepted text retention before publication.
 * @param candidate - complete candidate DOCX bytes.
 * @param source - last confirmed source or null for a new document.
 * @param minRetainedTextRatio - deployment minimum accepted-text retention ratio.
 * @returns classified validation results without document bytes in diagnostics.
 */
export async function validateDocxCandidate(
  candidate: ArrayBuffer, source: ArrayBuffer | null, minRetainedTextRatio: number,
): Promise<DocxValidationResult> {
  const issues: DocxValidationIssue[] = []
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(candidate)
  }
  catch (_error) {
    return {
      ok: false,
      issues: [{ code: 'not-a-zip' }],
      textLength: 0,
    }
  }
  for (const part of REQUIRED_PARTS) {
    if (!zip.file(part))
      issues.push({ code: 'missing-part', part })
  }
  if (issues.length > 0)
    return { ok: false, issues, textLength: 0 }
  const documentXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/.test(name))
      continue
    const content = await entry.async('string')
    parseXmlOrIssue(name, content, issues)
  }
  if (issues.length === 0) await validateComments(zip, parseXml(documentXml), issues)
  const relsEntry = zip.file('word/_rels/document.xml.rels')
  const rels = relsEntry ? relationshipIds(await relsEntry.async('string')) : new Set<string>()
  const dangling = [...referencedRelationshipIds(documentXml)].filter(id => !rels.has(id))
  if (dangling.length > 0) {
    issues.push({
      code: 'dangling-relationship',
      relationshipIds: dangling,
    })
  }
  const textLength = visibleText(documentXml).length
  if (source) {
    try {
      const sourceZip = await JSZip.loadAsync(source)
      const sourceXml = (await sourceZip.file('word/document.xml')?.async('string')) ?? ''
      const sourceLength = visibleText(sourceXml).length
      if (sourceLength > 0 && textLength < sourceLength * minRetainedTextRatio) {
        issues.push({
          code: 'content-collapsed',
          beforeCharacters: sourceLength, afterCharacters: textLength,
        })
      }
    }
    catch (_error) {
      issues.push({ code: 'invalid-source' })
    }
  }
  return { ok: issues.length === 0, issues, textLength }
}
