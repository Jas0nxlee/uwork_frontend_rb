/** Apache-2.0; adapted UWork tracked edits with namespace-aware preservation of run formatting and nontext content. */
import JSZip from 'jszip'
import { isWord, parseXml, serializeXml, WORD, wordDescendants, wordElement } from './xml.ts'

/** Counts of paragraph insertions, deletions, and text replacements. */
export interface TrackedChangeStats { inserted: number; deleted: number; modified: number }
/** Explicit identity recorded on newly created Word revisions. */
export interface TrackedChangeOptions { author: string; date: string }
/** Main-document XML and newly recorded edit counts. */
export interface TrackedChangesResult { xml: string; stats: TrackedChangeStats }

interface Paragraph { readonly element: Element; readonly text: string }

function belongsTo(node: Node, paragraph: Element): boolean {
  let parent = node.parentNode
  while (parent !== null && parent !== paragraph) {
    if (isWord(parent, 'p')) return false
    parent = parent.parentNode
  }
  return parent === paragraph
}

function excluded(node: Node, paragraph: Element, mode: 'accept' | 'reject'): boolean {
  let parent = node.parentNode
  while (parent !== null && parent !== paragraph) {
    if (isWord(parent, ...(mode === 'accept' ? ['del', 'moveFrom'] : ['ins', 'moveTo']))) return true
    parent = parent.parentNode
  }
  return false
}

function textOf(paragraph: Element, mode: 'accept' | 'reject'): string {
  return [...paragraph.getElementsByTagNameNS(WORD, '*')]
    .filter(node => isWord(node, 't', 'delText') && belongsTo(node, paragraph) && !excluded(node, paragraph, mode))
    .map(node => node.textContent).join('')
}

function paragraphs(doc: Document): Paragraph[] {
  return wordDescendants(doc, 'p').map(element => ({ element, text: textOf(element, 'accept') }))
}

function revision(doc: Document, kind: 'ins' | 'del', options: TrackedChangeOptions, nextId: () => number): Element {
  const node = wordElement(doc, kind)
  node.setAttributeNS(WORD, 'w:id', String(nextId()))
  node.setAttributeNS(WORD, 'w:author', options.author)
  node.setAttributeNS(WORD, 'w:date', options.date)
  return node
}

function runPart(run: Element, child: Node): Element {
  const result = run.cloneNode(false) as Element
  const properties = [...run.children].find(node => isWord(node, 'rPr'))
  if (properties !== undefined) result.append(properties.cloneNode(true))
  result.append(child)
  return result
}

function selectedRuns(paragraph: Element, start: number, end: number, doc: Document): Element[] {
  const result: Element[] = []
  let offset = 0
  for (const run of wordDescendants(paragraph, 'r')) {
    if (!belongsTo(run, paragraph) || excluded(run, paragraph, 'accept')) continue
    for (const child of run.children) {
      if (!isWord(child, 't')) continue
      const value = child.textContent
      const from = Math.max(start - offset, 0)
      const to = Math.min(end - offset, value.length)
      if (from < to) {
        const text = wordElement(doc, 'delText')
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
        text.textContent = value.slice(from, to)
        result.push(doc.importNode(runPart(run, text), true))
      }
      offset += value.length
    }
  }
  return result
}

function unmark(paragraph: Element): void {
  for (const node of [...paragraph.getElementsByTagNameNS(WORD, '*')].reverse()) {
    if (isWord(node, 'del', 'moveFrom')) node.remove()
    else if (isWord(node, 'ins', 'moveTo')) node.replaceWith(...node.childNodes)
  }
}

function replaceText(old: Paragraph, edited: Paragraph, options: TrackedChangeOptions, nextId: () => number): void {
  const paragraph = edited.element
  const doc = paragraph.ownerDocument
  unmark(paragraph)
  let prefix = 0
  while (prefix < old.text.length && prefix < edited.text.length && old.text[prefix] === edited.text[prefix]) prefix += 1
  let suffix = 0
  while (suffix < old.text.length - prefix && suffix < edited.text.length - prefix
    && old.text[old.text.length - 1 - suffix] === edited.text[edited.text.length - 1 - suffix]) suffix += 1
  const insertionEnd = edited.text.length - suffix
  const removed = selectedRuns(old.element, prefix, old.text.length - suffix, doc)
  const deletion = removed.length === 0 ? undefined : revision(doc, 'del', options, nextId)
  deletion?.append(...removed)
  let offset = 0
  for (const run of wordDescendants(paragraph, 'r')) {
    if (!belongsTo(run, paragraph)) continue
    const fragment = doc.createDocumentFragment()
    const placeDeletion = (): void => {
      if (deletion !== undefined && deletion.parentNode === null && offset >= prefix) fragment.append(deletion)
    }
    for (const child of [...run.childNodes]) {
      if (isWord(child, 'rPr')) continue
      if (!isWord(child, 't')) {
        placeDeletion()
        fragment.append(runPart(run, child.cloneNode(true)))
        continue
      }
      const value = child.textContent ?? ''
      const points = [...new Set([0, value.length, prefix - offset, insertionEnd - offset])]
        .filter(point => point >= 0 && point <= value.length).sort((a, b) => a - b)
      points.reduce((from, to) => {
        if (from === to) return to
        placeDeletion()
        const text = child.cloneNode(false) as Element
        text.textContent = value.slice(from, to)
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
        const piece = runPart(run, text)
        if (offset >= prefix && offset < insertionEnd) {
          const inserted = revision(doc, 'ins', options, nextId)
          inserted.append(piece)
          fragment.append(inserted)
        } else fragment.append(piece)
        offset += to - from
        return to
      }, 0)
    }
    run.replaceWith(fragment)
  }
  if (deletion !== undefined && deletion.parentNode === null) paragraph.append(deletion)
}

function sharedPrefix(left: readonly Paragraph[], right: readonly Paragraph[]): number {
  let count = 0
  for (const [index, paragraph] of left.entries()) {
    const other = right[index]
    if (other === undefined || paragraph.text !== other.text) break
    count += 1
  }
  return count
}

function deletedParagraph(old: Paragraph, doc: Document, options: TrackedChangeOptions, nextId: () => number): Element {
  const paragraph = wordElement(doc, 'p')
  const properties = [...old.element.children].find(node => isWord(node, 'pPr'))
  const pPr = properties === undefined ? wordElement(doc, 'pPr') : doc.importNode(properties, true)
  const rPr = wordElement(doc, 'rPr')
  rPr.append(revision(doc, 'del', options, nextId))
  pPr.append(rPr)
  paragraph.append(pPr)
  const content = revision(doc, 'del', options, nextId)
  content.append(...selectedRuns(old.element, 0, old.text.length, doc))
  paragraph.append(content)
  return paragraph
}

/**
 * Record text edits while retaining exported run properties and nontext objects.
 * @param baselineXml - last confirmed main-document XML.
 * @param editedXml - editor-exported main-document XML.
 * @param options - author and timestamp for new revisions.
 * @returns revised XML whose accept/reject views reproduce the two text versions.
 */
export function trackChangesInDocumentXml(
  baselineXml: string, editedXml: string, options: TrackedChangeOptions,
): TrackedChangesResult {
  const baselineDoc = parseXml(baselineXml)
  const editedDoc = parseXml(editedXml)
  const baseline = paragraphs(baselineDoc)
  const edited = paragraphs(editedDoc)
  const used = new Set([...wordDescendants(baselineDoc, '*'), ...wordDescendants(editedDoc, '*')]
    .map(node => node.getAttributeNS(WORD, 'id')).filter(id => id !== null))
  let next = 0
  const nextId = (): number => {
    while (used.has(String(next))) next += 1
    const result = next++
    used.add(String(result))
    return result
  }
  const stats = { inserted: 0, deleted: 0, modified: 0 }
  const head = sharedPrefix(baseline, edited)
  const tail = sharedPrefix(baseline.slice(head).toReversed(), edited.slice(head).toReversed())
  const oldMiddle = baseline.slice(head, baseline.length - tail)
  const newMiddle = edited.slice(head, edited.length - tail)
  const paired = Math.min(oldMiddle.length, newMiddle.length)
  for (const [index, old] of oldMiddle.entries()) {
    const current = newMiddle[index]
    if (current === undefined) break
    if (old.text === current.text) continue
    replaceText(old, current, options, nextId)
    stats.modified += 1
  }
  for (const current of newMiddle.slice(paired)) {
    unmark(current.element)
    const inserted = revision(editedDoc, 'ins', options, nextId)
    for (const child of [...current.element.childNodes]) if (!isWord(child, 'pPr')) inserted.append(child)
    current.element.append(inserted)
    stats.inserted += 1
  }
  const anchor = edited[edited.length - tail]?.element
  const body = editedDoc.getElementsByTagNameNS(WORD, 'body')[0]
  if (body === undefined) throw new Error('DOCX is missing a document body')
  for (const old of oldMiddle.slice(paired)) {
    const deleted = deletedParagraph(old, editedDoc, options, nextId)
    if (anchor !== undefined) anchor.before(deleted)
    else {
      const section = [...body.children].find(node => isWord(node, 'sectPr'))
      body.insertBefore(deleted, section ?? null)
    }
    stats.deleted += 1
  }
  return { xml: serializeXml(editedDoc), stats }
}

/**
 * Apply text revisions to a complete editor-exported archive.
 * @param baselineBytes - last confirmed DOCX bytes.
 * @param editedBytes - complete exported DOCX bytes.
 * @param options - author and timestamp for new revisions.
 * @returns complete revised bytes and new revision counts.
 */
export async function applyTrackedChanges(
  baselineBytes: ArrayBuffer, editedBytes: ArrayBuffer, options: TrackedChangeOptions,
): Promise<{ bytes: ArrayBuffer; stats: TrackedChangeStats }> {
  const baseline = await JSZip.loadAsync(baselineBytes)
  const edited = await JSZip.loadAsync(editedBytes)
  const old = await baseline.file('word/document.xml')?.async('string')
  const current = await edited.file('word/document.xml')?.async('string')
  if (old === undefined || current === undefined) throw new Error('DOCX is missing word/document.xml')
  const tracked = trackChangesInDocumentXml(old, current, options)
  edited.file('word/document.xml', tracked.xml)
  return { bytes: await edited.generateAsync({ type: 'arraybuffer' }), stats: tracked.stats }
}

/**
 * Read visible paragraph text with all revisions accepted.
 * @param documentXml - main-document XML.
 * @returns text after accepting revisions.
 */
export function acceptedText(documentXml: string): string {
  return wordDescendants(parseXml(documentXml), 'p').map(node => textOf(node, 'accept')).filter(Boolean).join('\n')
}

/**
 * Read visible paragraph text with all revisions rejected.
 * @param documentXml - main-document XML.
 * @returns text after rejecting revisions.
 */
export function rejectedText(documentXml: string): string {
  return wordDescendants(parseXml(documentXml), 'p').map(node => textOf(node, 'reject')).filter(Boolean).join('\n')
}
