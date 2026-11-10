// @vitest-environment jsdom
/** Review decisions retain original Word text and formatting. */
import JSZip from 'jszip'
import { expect, it } from 'vitest'
import { listRevisions, resolveRevisions, resolveRevisionsInDocx } from '../src/client/formats/docx/docxReview.ts'
import { WORD, parseXml, wordDescendants } from '../src/client/formats/docx/xml.ts'

const doc = (body: string) => `<w:document xmlns:w="${WORD}"><w:body><w:p>${body}</w:p></w:body></w:document>`
const insert = '<w:ins w:id="1" w:author="A &amp; B"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="1A73E8"/>'
  + '</w:rPr><w:t>新增 &amp; 内容</w:t></w:r></w:ins>'
const deleted = '<w:del w:id="2" w:author="C"><w:r><w:delText>删除内容</w:delText></w:r></w:del>'

it('lists revision authors as decoded text in paragraph order', () => {
  expect(listRevisions(doc(insert + deleted))).toMatchObject([
    { index: 0, kind: 'insert', text: '新增 & 内容', author: 'A & B', paragraph: 0 },
    { index: 1, kind: 'delete', text: '删除内容', author: 'C', paragraph: 0 },
  ])
})

it('accepts insertions without removing legitimate underline and color formatting', () => {
  const accepted = resolveRevisions(doc(insert + deleted), { action: 'accept' })
  const tree = parseXml(accepted.xml)
  expect(accepted.resolved).toBe(2)
  expect(accepted.remaining).toEqual([])
  expect(wordDescendants(tree, 't').map(node => node.textContent)).toEqual(['新增 & 内容'])
  expect(wordDescendants(tree, 'u')).toHaveLength(1)
  expect(wordDescendants(tree, 'color')[0]?.getAttributeNS(WORD, 'val')).toBe('1A73E8')
  expect(wordDescendants(tree, 'del')).toHaveLength(0)
})

it('rejects only the selected deletion and retains other pending revisions', () => {
  const result = resolveRevisions(doc(insert + deleted), { action: 'reject', targetIndex: 1 })
  const tree = parseXml(result.xml)
  expect(result.resolved).toBe(1)
  expect(result.remaining).toHaveLength(1)
  expect(wordDescendants(tree, 'ins')).toHaveLength(1)
  expect(wordDescendants(tree, 'delText')).toHaveLength(0)
  expect(wordDescendants(tree, 't').map(node => node.textContent)).toEqual(['新增 & 内容', '删除内容'])
  expect(resolveRevisions(result.xml, { action: 'accept', targetIndex: 99 })).toMatchObject({ xml: result.xml, resolved: 0 })
})

it('updates only the main document part in a valid archive', async () => {
  const zip = new JSZip().file('word/document.xml', doc(insert + deleted)).file('word/media/image.png', new Uint8Array([1, 2, 3]))
  const result = await resolveRevisionsInDocx(await zip.generateAsync({ type: 'arraybuffer' }), { action: 'reject' })
  const saved = await JSZip.loadAsync(result.bytes)
  const image = saved.file('word/media/image.png')
  const main = saved.file('word/document.xml')
  if (image === null || main === null) throw new Error('Review removed an unrelated archive part')
  expect(await image.async('uint8array')).toEqual(new Uint8Array([1, 2, 3]))
  expect(wordDescendants(parseXml(await main.async('string')), 't').map(node => node.textContent)).toEqual(['删除内容'])
})
