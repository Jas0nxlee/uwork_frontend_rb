/** Apache-2.0; adapted UWork header/footer preservation with complete OPC dependency copying. */
import JSZip from 'jszip'
import { CONTENT_TYPES, OFFICE_RELS, PACKAGE_RELS, WORD, isWord, parseXml, serializeXml, wordDescendants, wordElement } from './xml.ts'

/** Classified preservation outcome and the source parts copied into the exported package. */
export interface WordPreservationResult {
  bytes: ArrayBuffer
  note: 'none' | 'removed-default' | 'preserved'
  parts: string[]
}

const HEADER_FOOTER_TYPES = new Set([`${OFFICE_RELS}/header`, `${OFFICE_RELS}/footer`])
const COMMENTS_TYPE = `${OFFICE_RELS}/comments`

function relationships(xml: string | undefined): Document {
  return parseXml(xml ?? `<Relationships xmlns="${PACKAGE_RELS}"/>`)
}

function relativePart(owner: string, target: string): string {
  const parent = owner.split('/').slice(0, -1)
  const child = target.split('/')
  while (parent.length > 0 && child[0] === parent[0]) { parent.shift(); child.shift() }
  return [...parent.map(() => '..'), ...child].map(encodeURIComponent).join('/')
}

function resolvedPart(owner: string, target: string): string {
  if (target.includes('\\')) throw new Error('Invalid OPC relationship target')
  const resolved = new URL(target, `https://ooxml.invalid/${owner}`)
  if (resolved.origin !== 'https://ooxml.invalid' || resolved.search !== '' || resolved.hash !== '') {
    throw new Error('Invalid OPC internal relationship target')
  }
  return decodeURIComponent(resolved.pathname.slice(1))
}

function relationshipPart(owner: string): string {
  return owner.replace(/([^/]+)$/, '_rels/$1.rels')
}

function uniquePart(zip: JSZip, requested: string, reserved: ReadonlySet<string>): string {
  if (zip.file(requested) === null && !reserved.has(requested)) return requested
  let counter = 0
  for (;;) {
    const candidate = requested.replace(/(^|\/)([^/]*)$/, `$1uwork-${counter++}-$2`)
    if (zip.file(candidate) === null && !reserved.has(candidate)) return candidate
  }
}

function contentType(doc: Document, path: string): string {
  const override = [...doc.getElementsByTagNameNS(CONTENT_TYPES, 'Override')]
    .find(node => decodeURIComponent(node.getAttribute('PartName') ?? '') === `/${path}`)
  const extension = path.slice(path.lastIndexOf('.') + 1)
  const fallback = [...doc.getElementsByTagNameNS(CONTENT_TYPES, 'Default')]
    .find(node => node.getAttribute('Extension')?.toLowerCase() === extension.toLowerCase())
  const type = (override ?? fallback)?.getAttribute('ContentType')
  if (type === undefined || type === null || type === '') throw new Error('Missing OPC part content type')
  return type
}

/**
 * Preserve section headers, footers, referenced comments, and their complete internal part dependencies.
 * @param sourceBytes - complete original DOCX archive.
 * @param exportedBytes - complete editor-exported DOCX archive.
 * @returns preserved bytes and a classified outcome; ambiguous section mapping is refused.
 */
export async function preserveWordMetadata(sourceBytes: ArrayBuffer, exportedBytes: ArrayBuffer): Promise<WordPreservationResult> {
  const source = await JSZip.loadAsync(sourceBytes)
  const out = await JSZip.loadAsync(exportedBytes)
  const required = async (zip: JSZip, name: string): Promise<string> => {
    const part = zip.file(name)
    if (part === null) throw new Error(`Missing OPC part: ${name}`)
    return part.async('string')
  }
  const sourceMain = parseXml(await required(source, 'word/document.xml'))
  const outMain = parseXml(await required(out, 'word/document.xml'))
  const sourceSections = wordDescendants(sourceMain, 'sectPr')
  const outSections = wordDescendants(outMain, 'sectPr')
  const commentIds = new Set(['commentReference', 'commentRangeStart', 'commentRangeEnd']
    .flatMap(name => wordDescendants(outMain, name)).map(node => node.getAttributeNS(WORD, 'id')))
  const originalRefs = wordDescendants(sourceMain, 'headerReference').length + wordDescendants(sourceMain, 'footerReference').length
  const removedRefs = wordDescendants(outMain, 'headerReference').length + wordDescendants(outMain, 'footerReference').length
  if (originalRefs > 0 && sourceSections.length > 1 && outSections.length !== sourceSections.length) {
    throw new Error('Header/footer section mapping was lost during export')
  }
  for (const name of ['headerReference', 'footerReference']) {
    for (const ref of wordDescendants(outMain, name)) ref.remove()
  }
  const outRels = relationships(await out.file('word/_rels/document.xml.rels')?.async('string'))
  for (const rel of [...outRels.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')]) {
    if (HEADER_FOOTER_TYPES.has(rel.getAttribute('Type') ?? '') || rel.getAttribute('Type') === COMMENTS_TYPE) rel.remove()
  }
  if (originalRefs === 0 && commentIds.size === 0) {
    if (removedRefs === 0) return { bytes: exportedBytes, note: 'none', parts: [] }
    out.file('word/document.xml', serializeXml(outMain))
    out.file('word/_rels/document.xml.rels', serializeXml(outRels))
    return { bytes: await out.generateAsync({ type: 'arraybuffer' }), note: 'removed-default', parts: [] }
  }
  const sourceRels = relationships(await source.file('word/_rels/document.xml.rels')?.async('string'))
  const sourceTypes = parseXml(await required(source, '[Content_Types].xml'))
  const outTypes = parseXml(await required(out, '[Content_Types].xml'))
  const sourceComments = [...sourceRels.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')]
    .find(rel => rel.getAttribute('Type') === COMMENTS_TYPE)
  const commentsTarget = sourceComments?.getAttribute('Target')
  if (commentIds.size > 0 && (commentsTarget === undefined || commentsTarget === null || commentsTarget === ''
    || sourceComments?.getAttribute('TargetMode') === 'External')) throw new Error('Missing source comments relationship')
  const commentsPath = commentsTarget === undefined || commentsTarget === null ? undefined : resolvedPart('word/document.xml', commentsTarget)
  const copied = new Map<string, string>()
  const reserved = new Set<string>()
  const addOverride = (path: string, type: string): void => {
    const existing = [...outTypes.getElementsByTagNameNS(CONTENT_TYPES, 'Override')]
      .find(node => node.getAttribute('PartName') === `/${path}`)
    const node = existing ?? outTypes.createElementNS(CONTENT_TYPES, 'Override')
    node.setAttribute('PartName', `/${path}`)
    node.setAttribute('ContentType', type)
    if (existing === undefined) outTypes.documentElement.append(node)
  }
  const copyPart = async (path: string): Promise<string> => {
    const existing = copied.get(path)
    if (existing !== undefined) return existing
    const entry = source.file(path)
    if (entry === null) throw new Error('Missing dependent header/footer part')
    const destination = uniquePart(out, path, reserved)
    copied.set(path, destination)
    reserved.add(destination)
    if (path === commentsPath) {
      const comments = parseXml(await entry.async('string'))
      const found = new Set<string>()
      for (const comment of wordDescendants(comments, 'comment')) {
        const id = comment.getAttributeNS(WORD, 'id')
        if (id === null || !commentIds.has(id)) comment.remove()
        else found.add(id)
      }
      if ([...commentIds].some(id => id === null || !found.has(id))) throw new Error('Missing source comment record')
      out.file(destination, serializeXml(comments))
    } else out.file(destination, await entry.async('uint8array'))
    addOverride(destination, contentType(sourceTypes, path))
    const rels = source.file(relationshipPart(path))
    if (rels !== null) {
      const rewritten = parseXml(await rels.async('string'))
      for (const rel of [...rewritten.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')]) {
        if (rel.getAttribute('TargetMode') === 'External') continue
        const target = rel.getAttribute('Target')
        if (target === null || target === '') throw new Error('Missing OPC relationship target')
        const copiedTarget = await copyPart(resolvedPart(path, target))
        rel.setAttribute('Target', relativePart(destination, copiedTarget))
      }
      const relsPath = relationshipPart(destination)
      out.file(relsPath, serializeXml(rewritten))
      addOverride(relsPath, contentType(sourceTypes, relationshipPart(path)))
    }
    return destination
  }
  if (originalRefs > 0 && outSections.length === 0) {
    const body = outMain.getElementsByTagNameNS(WORD, 'body')[0]
    if (body === undefined) throw new Error('DOCX is missing a document body')
    const section = wordElement(outMain, 'sectPr')
    body.append(section)
    outSections.push(section)
  }
  const usedIds = new Set([...outRels.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')].map(node => node.getAttribute('Id')))
  let counter = 0
  for (const [index, outSection] of outSections.entries()) {
    if (originalRefs === 0) break
    const section = sourceSections.length === 1 ? sourceSections[0] : sourceSections[index]
    if (section === undefined) throw new Error('Cannot map header/footer section')
    for (const ref of [...section.children].filter(node => isWord(node, 'headerReference', 'footerReference'))) {
      const id = ref.getAttributeNS(OFFICE_RELS, 'id')
      const original = [...sourceRels.getElementsByTagNameNS(PACKAGE_RELS, 'Relationship')].find(node => node.getAttribute('Id') === id)
      const type = `${OFFICE_RELS}/${ref.localName === 'headerReference' ? 'header' : 'footer'}`
      const target = original?.getAttribute('Target')
      if (original === undefined || original.getAttribute('Type') !== type || original.getAttribute('TargetMode') === 'External'
        || target === undefined || target === null || target === '') throw new Error('Invalid header/footer relationship')
      const destination = await copyPart(resolvedPart('word/document.xml', target))
      while (usedIds.has(`uworkHeaderFooter${counter}`)) counter += 1
      const newId = `uworkHeaderFooter${counter++}`
      usedIds.add(newId)
      const rel = outRels.createElementNS(PACKAGE_RELS, 'Relationship')
      rel.setAttribute('Id', newId)
      rel.setAttribute('Type', type)
      rel.setAttribute('Target', relativePart('word/document.xml', destination))
      outRels.documentElement.append(rel)
      const retained = outMain.importNode(ref, true)
      retained.setAttributeNS(OFFICE_RELS, 'r:id', newId)
      outSection.prepend(retained)
    }
  }
  if (commentIds.size > 0 && commentsPath !== undefined) {
    const comments = await copyPart(commentsPath)
    while (usedIds.has(`uworkComments${counter}`)) counter += 1
    const rel = outRels.createElementNS(PACKAGE_RELS, 'Relationship')
    rel.setAttribute('Id', `uworkComments${counter}`)
    rel.setAttribute('Type', COMMENTS_TYPE)
    rel.setAttribute('Target', relativePart('word/document.xml', comments))
    outRels.documentElement.append(rel)
  }
  out.file('word/document.xml', serializeXml(outMain))
  out.file('word/_rels/document.xml.rels', serializeXml(outRels))
  out.file('[Content_Types].xml', serializeXml(outTypes))
  return { bytes: await out.generateAsync({ type: 'arraybuffer' }), note: 'preserved', parts: [...copied.values()] }
}
