// @vitest-environment jsdom
/** DOCX preservation is checked against real ZIP parts and parsed WordprocessingML. */
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { acceptedText, rejectedText, trackChangesInDocumentXml } from '../src/client/formats/docx/docxTrackChanges.ts'
import { preserveWordMetadata } from '../src/client/formats/docx/docxPreservation.ts'
import { validateDocxCandidate } from '../src/client/formats/docx/docxValidate.ts'
import { applyRevisionView, restoreRevisions, removeCommentMarkup, stripCommentsFromPreservation } from '../src/client/formats/docx/docxRevisions.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const xml = (body: string) => `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const options = { author: 'UWork "审阅人" & Test', date: '2026-11-10T00:00:00.000Z' }

it('removes comment anchors while retaining text in the same run and unrelated comments', () => {
  const body = '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>必须保留</w:t><w:commentReference w:id="1"/></w:r>'
    + '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="2"/></w:r></w:p>'
  const result = removeCommentMarkup(xml(body), ['1', 'missing'])
  const doc = parsed(result.xml)
  expect(result.removed).toBe(1)
  expect(doc.getElementsByTagNameNS(W, 't')[0]?.textContent).toBe('必须保留')
  expect([...doc.getElementsByTagNameNS(W, 'commentReference')].map(node => node.getAttributeNS(W, 'id'))).toEqual(['2'])
  expect(doc.getElementsByTagNameNS(W, 'commentRangeStart')).toHaveLength(0)
})

it('retains remaining comment counts and paragraph namespace attributes after removing one preserved comment', () => {
  const originalXml = '<w:p w14:paraId="ABCD"><w:r><w:t>正文</w:t><w:commentReference w:id="1"/>'
    + '<w:commentReference w:id="2"/></w:r></w:p>'
  const result = stripCommentsFromPreservation({
    namespaces: [{ name: 'xmlns:w', uri: W }, { name: 'xmlns:w14', uri: 'urn:word-2010' }],
    paragraphs: [{ index: 0, originalXml, displayText: '正文', acceptedText: '正文', inserted: 0, deleted: 0, comments: 2 }],
    comments: [{ index: 0, id: '1', author: 'A', date: '', text: '一', paragraph: 0, anchorText: '正文' },
      { index: 1, id: '2', author: 'B', date: '', text: '二', paragraph: 0, anchorText: '正文' }],
  }, ['1'])
  expect(result.paragraphs[0]?.comments).toBe(1)
  const paragraphXml = result.paragraphs[0]?.originalXml
  if (paragraphXml === undefined) throw new Error('Missing preserved paragraph')
  const paragraphNode = parsed(paragraphXml).documentElement
  expect(paragraphNode.getAttributeNS('urn:word-2010', 'paraId')).toBe('ABCD')
  expect(paragraphNode.textContent).toBe('正文')
  expect(result.comments.map(comment => comment.id)).toEqual(['2'])
})

it('refuses comment anchors without their relationship or referenced records before editing', async () => {
  const body = '<w:p><w:commentRangeStart w:id="4"/><w:r><w:t>正文</w:t></w:r><w:commentRangeEnd w:id="4"/></w:p>'
  expect((await validateDocxCandidate(await archive(body), null, 0.8)).issues).toContainEqual({
    code: 'dangling-comment', part: 'word/_rels/document.xml.rels',
  })
  const rels = `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/comments" Target="comments.xml"/></Relationships>`
  const parts = { 'word/_rels/document.xml.rels': rels,
    'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="5"/></w:comments>` }
  expect((await validateDocxCandidate(await archive(body, parts), null, 0.8)).issues).toContainEqual({
    code: 'dangling-comment', part: 'comments.xml',
  })
  parts['word/comments.xml'] = `<w:comments xmlns:w="${W}"><w:comment w:id="4"/></w:comments>`
  expect((await validateDocxCandidate(await archive(body, parts), null, 0.8)).ok).toBe(true)
  for (const target of ['http://[', 'https://example.com/comments.xml', 'missing.xml']) {
    parts['word/_rels/document.xml.rels'] = rels.replace('Target="comments.xml"', `Target="${target}"`)
    expect((await validateDocxCandidate(await archive(body, parts), null, 0.8)).issues).toContainEqual({
      code: 'dangling-comment', part: target,
    })
  }
})

async function archive(body: string, parts: Record<string, string | Uint8Array> = {}): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<Types xmlns="${CT}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="${REL}"/>`)
  zip.file('word/document.xml', xml(body))
  for (const [name, content] of Object.entries(parts)) zip.file(name, content)
  return zip.generateAsync({ type: 'arraybuffer' })
}

function parsed(value: string): Document {
  const doc = new DOMParser().parseFromString(value, 'application/xml')
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  return doc
}

it('keeps XML characters readable when accepting and rejecting tracked edits', () => {
  const before = xml(paragraph('合同 A &amp; B &lt; C'))
  const after = xml(paragraph('合同 A &amp; B &lt; D'))
  const result = trackChangesInDocumentXml(before, after, options)
  parsed(result.xml)
  expect(acceptedText(result.xml)).toBe('合同 A & B < D')
  expect(rejectedText(result.xml)).toBe('合同 A & B < C')
})

it('retains run formatting and inline drawings while recording a text edit', () => {
  const before = xml('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>合同内容A</w:t></w:r><w:r><w:drawing/></w:r></w:p>')
  const after = xml('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>合同内容B</w:t></w:r><w:r><w:drawing/></w:r></w:p>')
  const result = parsed(trackChangesInDocumentXml(before, after, options).xml)
  expect(result.getElementsByTagNameNS(W, 'drawing')).toHaveLength(1)
  const unchanged = [...result.getElementsByTagNameNS(W, 'r')].find(run => run.textContent === '合同内容')
  expect(unchanged?.getElementsByTagNameNS(W, 'b')).toHaveLength(1)
})

it('uses distinct revision ids when deleting multiple paragraphs', () => {
  const before = xml(paragraph('保留') + paragraph('删除一') + paragraph('删除二'))
  const after = xml(paragraph('保留'))
  const result = parsed(trackChangesInDocumentXml(before, after, options).xml)
  const ids = [...result.getElementsByTagNameNS(W, 'del')].map(node => node.getAttributeNS(W, 'id'))
  expect(new Set(ids).size).toBe(ids.length)
})

it('keeps deleted final paragraphs inside the document body', () => {
  const before = xml(paragraph('删除全部'))
  const after = xml('')
  const result = trackChangesInDocumentXml(before, after, options)
  const doc = parsed(result.xml)
  expect(doc.documentElement.localName).toBe('document')
  expect(doc.getElementsByTagNameNS(W, 'body')[0]?.getElementsByTagNameNS(W, 'p')).toHaveLength(1)
  expect(rejectedText(result.xml)).toBe('删除全部')
})

it('rejects corrupt XML, missing parts, dangling relationships, and untrusted source bytes', async () => {
  const broken = await archive('<w:p>')
  expect((await validateDocxCandidate(broken, null, 0.8)).issues).toContainEqual(expect.objectContaining({ code: 'invalid-xml' }))
  const missing = await new JSZip().generateAsync({ type: 'arraybuffer' })
  expect((await validateDocxCandidate(missing, null, 0.8)).issues).toContainEqual(expect.objectContaining({ code: 'missing-part' }))
  const dangling = await archive('<w:p><w:hyperlink r:id="missing"><w:r><w:t>链接</w:t></w:r></w:hyperlink></w:p>')
  expect((await validateDocxCandidate(dangling, null, 0.8)).issues).toContainEqual(expect.objectContaining({ code: 'dangling-relationship' }))
  const valid = await archive(paragraph('内容'))
  expect((await validateDocxCandidate(valid, new Uint8Array([1, 2]).buffer, 0.8)).issues)
    .toContainEqual(expect.objectContaining({ code: 'invalid-source' }))
})

it('preserves header image dependencies and remaps conflicting exported relationship ids', async () => {
  const source = await archive(paragraph('原文') + '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>', {
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/></Relationships>`,
    'word/header1.xml': `<w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:r><w:drawing r:embed="headerImage"/></w:r></w:p></w:hdr>`,
    'word/_rels/header1.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="headerImage" Type="${R}/image" Target="media/logo.png"/></Relationships>`,
    'word/media/logo.png': new Uint8Array([1, 2, 3]),
  })
  const edited = await archive('<w:p><w:r><w:drawing r:embed="rId1"/></w:r><w:r><w:t>修改</w:t></w:r></w:p>', {
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/image" Target="media/logo.png"/></Relationships>`,
    'word/media/logo.png': new Uint8Array([4, 5, 6]),
  })
  const result = await preserveWordMetadata(source, edited)
  const zip = await JSZip.loadAsync(result.bytes)
  const doc = parsed(await required(zip.file('word/document.xml')).async('string'))
  const ref = doc.getElementsByTagNameNS(W, 'headerReference')[0]
  expect(ref).toBeDefined()
  const rels = parsed(await required(zip.file('word/_rels/document.xml.rels')).async('string'))
  const header = [...rels.getElementsByTagNameNS(REL, 'Relationship')].find(rel => rel.getAttribute('Id') === ref?.getAttributeNS(R, 'id'))
  expect(header?.getAttribute('Type')).toBe(`${R}/header`)
  const path = `word/${required(header!.getAttribute('Target'))}`
  const headerRelsPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
  const headerRels = parsed(await required(zip.file(headerRelsPath)).async('string'))
  const image = required(headerRels.getElementsByTagNameNS(REL, 'Relationship')[0]!.getAttribute('Target'))
  const imagePath = new URL(image, `https://ooxml.invalid/${path}`).pathname.slice(1)
  expect(await required(zip.file(imagePath)).async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  expect(await required(zip.file('word/media/logo.png')).async('uint8array')).toEqual(new Uint8Array([4, 5, 6]))
})

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing DOCX test fixture part')
  return value
}

it('preserves referenced comments and removes deleted comment records from the saved metadata', async () => {
  const source = await archive(paragraph('正文'), {
    'word/_rels/document.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="comments" Type="${R}/comments" Target="comments.xml"/></Relationships>`,
    'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="1" w:author="张三"><w:p><w:r><w:t>保留批注</w:t></w:r></w:p></w:comment><w:comment w:id="2"><w:p><w:r><w:t>删除批注</w:t></w:r></w:p></w:comment></w:comments>`,
  })
  const exported = await archive('<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>正文</w:t></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>')
  const saved = await preserveWordMetadata(source, exported)
  const zip = await JSZip.loadAsync(saved.bytes)
  const rels = parsed(await required(zip.file('word/_rels/document.xml.rels')).async('string'))
  const rel = required([...rels.getElementsByTagNameNS(REL, 'Relationship')].find(node => node.getAttribute('Type') === `${R}/comments`))
  const path = `word/${required(rel.getAttribute('Target'))}`
  const comments = parsed(await required(zip.file(path)).async('string'))
  const nodes = comments.getElementsByTagNameNS(W, 'comment')
  expect(nodes).toHaveLength(1)
  expect(required(nodes[0]).getAttributeNS(W, 'id')).toBe('1')
  expect(comments.documentElement.textContent).toBe('保留批注')
})

it('retains source namespace declarations required by unchanged reviewed paragraphs', async () => {
  const zip = await JSZip.loadAsync(await archive(''))
  const namespace = 'http://schemas.microsoft.com/office/word/2010/wordml'
  zip.file('word/document.xml', xml('<w:p w14:paraId="AABBCCDD"><w:ins w:id="8"><w:r><w:t>原修订</w:t></w:r></w:ins></w:p>')
    .replace('<w:document ', `<w:document xmlns:w14="${namespace}" `))
  const view = await applyRevisionView(await zip.generateAsync({ type: 'arraybuffer' }))
  const edited = await archive(paragraph('原修订'))
  const saved = await restoreRevisions(edited, view.preservation)
  expect(saved.restored).toBe(1)
  const result = await JSZip.loadAsync(saved.bytes)
  const doc = parsed(await required(result.file('word/document.xml')).async('string'))
  expect(required(doc.getElementsByTagNameNS(W, 'p')[0]).getAttributeNS(namespace, 'paraId')).toBe('AABBCCDD')
  expect(doc.getElementsByTagNameNS(W, 'ins')).toHaveLength(1)
})
