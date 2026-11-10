/** Namespace-aware OOXML XML operations shared by import, preservation, and validation. */
/** WordprocessingML namespace fixed by ECMA-376. */
export const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
/** Office document relationship namespace fixed by ECMA-376. */
export const OFFICE_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
/** OPC relationship namespace fixed by ECMA-376. */
export const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
/** OPC content-type namespace fixed by ECMA-376. */
export const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'

/**
 * Parse an OOXML part and reject malformed XML.
 * @param value - complete XML part.
 * @returns parsed XML; malformed input is refused.
 */
export function parseXml(value: string): XMLDocument {
  const doc = new DOMParser().parseFromString(value, 'application/xml')
  if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) throw new Error('Invalid OOXML XML')
  return doc
}

/**
 * Serialize a document or subtree with its XML namespaces.
 * @param node - document or subtree.
 * @returns namespace-preserving XML serialization.
 */
export function serializeXml(node: Node): string { return new XMLSerializer().serializeToString(node) }

/**
 * Create a WordprocessingML element in its owning document.
 * @param doc - owning XML document.
 * @param name - WordprocessingML local name.
 * @returns a namespaced element.
 */
export function wordElement(doc: Document, name: string): Element { return doc.createElementNS(WORD, `w:${name}`) }

/**
 * Match an element by its WordprocessingML namespace and local name.
 * @param node - DOM node.
 * @param names - WordprocessingML local names.
 * @returns whether the node is one of those elements.
 */
export function isWord(node: Node, ...names: readonly string[]): boolean {
  return node instanceof Element && node.namespaceURI === WORD && names.includes(node.localName)
}

/**
 * Collect WordprocessingML descendants in document order.
 * @param element - document element.
 * @param name - WordprocessingML local name.
 * @returns descendants in document order.
 */
export function wordDescendants(element: Element | Document, name: string): Element[] {
  return [...element.getElementsByTagNameNS(WORD, name)]
}

/**
 * Decode XML text and character references.
 * @param value - XML-escaped text content without surrounding markup.
 * @returns decoded text, including character references.
 */
export function decodeXmlText(value: string): string { return parseXml(`<text>${value}</text>`).documentElement.textContent }
