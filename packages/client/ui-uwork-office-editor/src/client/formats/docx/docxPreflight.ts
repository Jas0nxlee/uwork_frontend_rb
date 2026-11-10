/** Apache-2.0; adapted UWork DOCX handling. Original license and revision are retained in licenses/UWork.notice.txt. */
import JSZip from 'jszip'
/** DOCX docx findings. */
export interface DocxFindings {
  revisions: {
    inserted: number
    deleted: number
    formatChanges: number
  }
  comments: number
  footnotes: number
  hyperlinks: number
  formulas: number
  contentControls: number
  fields: number
  numbering: number
  hasHeaderFooter: boolean
  documentXmlBytes: number
}
/**
 * Create zeroed DOCX feature counts.
 * @returns empty feature counts.
 */
export function emptyFindings(): DocxFindings {
  return {
    revisions: { inserted: 0, deleted: 0, formatChanges: 0 },
    comments: 0,
    footnotes: 0,
    hyperlinks: 0,
    formulas: 0,
    contentControls: 0,
    fields: 0,
    numbering: 0,
    hasHeaderFooter: false,
    documentXmlBytes: 0,
  }
}
function countOf(xml: string, pattern: RegExp): number {
  return (xml.match(pattern) ?? []).length
}
/**
 * Count import-sensitive features in the main document.
 * @param xml - main document XML.
 * @param options - explicit operation options.
 * @returns the transformed document data and operation metadata.
 */
export function analyzeDocumentXml(xml: string, options: {
  hasHeaderFooter?: boolean
} = {}): DocxFindings {
  return {
    revisions: {
      inserted: countOf(xml, /<w:ins[ >]/g),
      deleted: countOf(xml, /<w:(del|moveFrom)[ >]/g),
      formatChanges: countOf(xml, /<w:\w+PrChange[ >]/g),
    },
    comments: countOf(xml, /<w:commentReference[ >]/g),
    footnotes: countOf(xml, /<w:(footnote|endnote)Reference[ >]/g),
    hyperlinks: countOf(xml, /<w:hyperlink[ >]/g),
    formulas: countOf(xml, /<m:oMath[ >]/g),
    contentControls: countOf(xml, /<w:sdt[ >]/g),
    fields: countOf(xml, /<w:fldSimple[ >]/g),
    numbering: countOf(xml, /<w:numPr[ >]/g),
    hasHeaderFooter: options.hasHeaderFooter ?? false,
    documentXmlBytes: new TextEncoder().encode(xml).length,
  }
}
/** DOCX normalize result. */
export interface NormalizeResult {
  xml: string
  changes: NormalizationChange[]
}
/**
 * Normalize unsupported wrappers while retaining their visible text.
 * @param xml - main document XML.
 * @returns the transformed document data and operation metadata.
 */
export function normalizeDocumentXml(xml: string): NormalizeResult {
  const changes: NormalizationChange[] = []
  let out = xml
  const unwrap = (tag: string): number => {
    let count = 0
    for (;;) {
      const match = new RegExp(`<${tag}(?:\\s[^>]*)?>`).exec(out)
      if (!match)
        break
      const end = out.indexOf(`</${tag}>`, match.index)
      if (end < 0)
        break
      out =
        out.slice(0, match.index) +
                    out.slice(match.index + match[0].length, end) +
                    out.slice(end + `</${tag}>`.length)
      count += 1
    }
    return count
  }
  const links = countOf(out, /<w:hyperlink[ >]/g)
  unwrap('w:hyperlink')
  if (links > 0)
    changes.push({ kind: 'hyperlinks', count: links })
  const formulas = countOf(out, /<m:oMath[ >]/g)
  if (formulas > 0) {
    out = out.replace(/<m:oMath(?:\s[^>]*)?>[\s\S]*?<\/m:oMath>/g, (block) => {
      const text = [...block.matchAll(/<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g)]
        .map(m => m[1])
        .join('')
      return text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''
    })
    changes.push({ kind: 'formulas', count: formulas })
  }
  const controls = countOf(out, /<w:sdt[ >]/g)
  for (;;) {
    const start = out.search(/<w:sdt[\s>]/)
    if (start < 0)
      break
    const contentStart = out.indexOf('<w:sdtContent', start)
    const end = out.indexOf('</w:sdt>', start)
    if (contentStart < 0 || end < 0)
      break
    const openEnd = out.indexOf('>', contentStart) + 1
    const contentEnd = out.indexOf('</w:sdtContent>', openEnd)
    if (contentEnd < 0 || contentEnd > end)
      break
    out = out.slice(0, start) + out.slice(openEnd, contentEnd) + out.slice(end + '</w:sdt>'.length)
  }
  if (controls > 0)
    changes.push({ kind: 'contentControls', count: controls })
  return { xml: out, changes }
}
/** DOCX docx preflight result. */
export interface DocxPreflightResult {
  bytes: ArrayBuffer
  findings: DocxFindings
  changes: NormalizationChange[]
}
/**
 * Inspect and normalize a complete DOCX before editor import.
 * @param bytes - complete DOCX bytes.
 * @returns the transformed document data and operation metadata.
 */
export async function preprocessDocx(bytes: ArrayBuffer): Promise<DocxPreflightResult> {
  const zip = await JSZip.loadAsync(bytes)
  const documentEntry = zip.file('word/document.xml')
  if (!documentEntry)
    throw new Error('DOCX is missing word/document.xml')
  const original = await documentEntry.async('string')
  const hasHeaderFooter = Boolean(zip.file('word/header1.xml')) || Boolean(zip.file('word/footer1.xml'))
  const findings = analyzeDocumentXml(original, { hasHeaderFooter })
  const { xml, changes } = normalizeDocumentXml(original)
  zip.file('word/document.xml', xml)
  return { bytes: await zip.generateAsync({ type: 'arraybuffer' }), findings, changes }
}
/**
 * List features whose content requires an explicit loss decision.
 * @param findings - observed import feature counts.
 * @returns the transformed document data and operation metadata.
 */
export function summarizeFindings(findings: DocxFindings): LossyFinding[] {
  const lines: LossyFinding[] = []
  if (findings.footnotes) {
    lines.push({ kind: 'footnotes', count: findings.footnotes })
  }
  return lines
}
/** DOCX normalization change. */
export interface NormalizationChange {
  kind: 'hyperlinks' | 'formulas' | 'contentControls'
  count: number
}
/** DOCX lossy finding. */
export interface LossyFinding {
  kind: 'footnotes'
  count: number
}
