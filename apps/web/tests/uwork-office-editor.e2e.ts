/** Optional Office bundle through the real Host, generated Remote calls, and browser artifact. */
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import JSZip from 'jszip'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, captureStableAria, compareOrRefreshGolden, webSnapshotMode,
  type WebScaffold } from './scaffold.ts'
import { newEnglishPage, connectFreshWorkspace, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-office-editor', import.meta.url))
const sample = fileURLToPath(new URL('../../../packages/client/ui-uwork-office-editor/tests/fixtures/report.docx', import.meta.url))
const expected = fileURLToPath(new URL('./expected/uwork-office-editor/unsaved.expected.md', import.meta.url))
let scaffold: WebScaffold
let browser: Browser
let page: Page
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(bundle, 'package.json')],
    extraOverlayPath: join(bundle, 'cordis.patch.yml'),
    profile: { hmr: false, packages: [] },
  })
  await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
  await copyFile(sample, join(scaffold.workspaceCwd, 'workspace/report.docx'))
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]')
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
}, 120_000)

afterAll(async () => {
  try { await browser?.close() } finally { await scaffold?.close() }
})

it('opens the built Word engine, saves revisions, and protects edits when closing', async () => {
  onTestFailed(() => saveFailureShot(page, 'uwork-office-editor'))
  const expand = page.locator('[data-sidebar-right-expand]')
  if (await expand.isVisible()) await expand.click()
  await page.locator('[data-sidebar-right-guide-entry="files"]').click()
  await page.getByRole('button', { name: 'report.docx', exact: true }).dblclick()
  const editor = page.locator('[data-uwork-office-editor]')
  await editor.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 })
  const canvas = editor.locator('canvas[data-index="0"]')
  await canvas.click({ position: { x: 130, y: 110 } })
  await page.waitForFunction(() => document.activeElement?.classList.contains('ce-inputarea') === true)
  await page.keyboard.type('UWORK_EDITOR_ROUNDTRIP')
  await editor.getByText('Unsaved changes', { exact: true }).waitFor()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 })
  const saved = await JSZip.loadAsync(await readFile(join(scaffold.workspaceCwd, 'workspace/report.docx')))
  const main = saved.file('word/document.xml')
  if (main === null) throw new Error('Saved DOCX has no main document')
  expect(await main.async('string')).toContain('UWORK_EDITOR_ROUNDTRIP')
  expect(await main.async('string')).toContain('w:ins')
  await canvas.click({ position: { x: 130, y: 110 } })
  await page.waitForFunction(() => document.activeElement?.classList.contains('ce-inputarea') === true)
  await page.keyboard.type('UNSAVED')
  await editor.getByText('Unsaved changes', { exact: true }).waitFor()
  await compareOrRefreshGolden(expected,
    await captureStableAria(page, '[data-uwork-office-editor]', scaffold.workspaceCwd), webSnapshotMode())
  await page.getByRole('tab', { name: 'report.docx Close', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  const prompt = page.getByRole('dialog', { name: 'Unsaved document' })
  await prompt.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await editor.getByText('Unsaved changes', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'report.docx Close', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await prompt.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await editor.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'report.docx', exact: true }).dblclick()
  await editor.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 })
  expect(await canvas.isVisible()).toBe(true)
  const reopened = await JSZip.loadAsync(await readFile(join(scaffold.workspaceCwd, 'workspace/report.docx')))
  const reopenedMain = reopened.file('word/document.xml')
  if (reopenedMain === null) throw new Error('Reopened DOCX has no main document')
  expect(await reopenedMain.async('string')).toContain('UWORK_EDITOR_ROUNDTRIP')
  expect(await reopenedMain.async('string')).not.toContain('UNSAVED')
  await canvas.click({ position: { x: 130, y: 150 } })
  await page.waitForFunction(() => document.activeElement?.classList.contains('ce-inputarea') === true)
  await page.keyboard.type('LOCAL_PENDING')
  await editor.getByText('Unsaved changes', { exact: true }).waitFor()
  reopened.file('word/document.xml', (await reopenedMain.async('string')).replace('Methodology notes', 'EXTERNAL_UPDATE Methodology notes'))
  const externalBytes = await reopened.generateAsync({ type: 'nodebuffer' })
  await writeFile(join(scaffold.workspaceCwd, 'workspace/report.docx'), externalBytes)
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.getByRole('alert').getByText('The file changed outside the editor. Reload after keeping a copy of your changes.').waitFor()
  expect(await readFile(join(scaffold.workspaceCwd, 'workspace/report.docx'))).toEqual(externalBytes)
  await editor.getByRole('button', { name: 'Reload', exact: true }).click()
  const reload = page.getByRole('dialog', { name: 'Reload', exact: true })
  await reload.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await editor.getByText('Saved', { exact: true }).waitFor({ timeout: 30_000 })
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 90_000)
