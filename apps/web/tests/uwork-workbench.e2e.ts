/** UWork workbench presentation through the real Web profile, file preview and retained Browser provider. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { createProcessInspector } from '@deepseek-ai/dsh-subprocess-local/src/process-inspector.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { realOfficeBytes } from './office-fixture.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const seed = fileURLToPath(new URL('../../../snapshots/web/markdown-file-links/session.v3.jsonl', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-workbench/', import.meta.url))
const expected = fileURLToPath(new URL('./expected/uwork-workbench/surface.expected.md', import.meta.url))
const longName = 'enterprise-research-report-长文件名验证文档标签溢出与关闭操作仍然可达.txt'

it('preserves native file and browser navigation across themes, fullscreen, split, narrow layout and close', async () => {
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(bundle, 'package.json')],
    extraOverlayPath: [join(bundle, 'cordis.patch.yml'),
      fileURLToPath(new URL('./sidebar-browser.overlay.yml', import.meta.url)),
      ...(process.platform === 'win32' ? [] : [fileURLToPath(new URL('./fixtures/sidebar-terminal.patch.yml', import.meta.url))])],
    profile: { hmr: false, packages: [] },
  })
  const resources: { browser?: Browser } = {}
  onTestFinished(async () => { try { await resources.browser?.close() } finally { await scaffold.close() } })
  await mkdir(join(scaffold.workspaceCwd, 'src'), { recursive: true })
  const lines = Array.from({ length: 40 }, (_, index) => `source line ${index + 1}\n`).join('')
  await writeFile(join(scaffold.workspaceCwd, 'src', longName), lines)
  const workbookBytes = realOfficeBytes('xlsx')
  const workbookPath = join(scaffold.workspaceCwd, 'read-only-workbook.xlsx')
  await writeFile(workbookPath, workbookBytes)
  const documentBytes = realOfficeBytes('docx')
  const documentPath = join(scaffold.workspaceCwd, 'read-only-document.docx')
  await writeFile(documentPath, documentBytes)
  const fixture = (await readFile(seed, 'utf8')).replaceAll('src/example.txt', `src/${longName}`)
  await seedSession(scaffold, fixture, 'uwork-workbench-browser')
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'uwork-workbench'))
  await page.route('https://workbench.uwork.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><style>html{color-scheme:light dark}body{background:Canvas;color:CanvasText}</style></head><body><h1>Workbench browser fixture</h1><input aria-label="Retained browser input"></body></html>',
  }))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('treeitem').first().click()
  await page.getByRole('treeitem').nth(1).click()
  await page.getByRole('button', { name: `src/${longName}:24–30`, exact: true }).click()
  const column = page.locator('[data-rightbar-col]')
  const product = column.locator('[data-uwork-workbench]')
  await product.waitFor({ state: 'attached' })
  const preview = column.locator('[data-textpreview-target="24"]')
  await expect.poll(() => preview.textContent()).toBe('source line 24\n')
  expect(await preview.locator('[contenteditable="true"], textarea, input').count()).toBe(0)
  const fileTab = column.locator('[data-dockkit-tab]').filter({ hasText: longName }).first()
  const fileId = await fileTab.getAttribute('data-dockkit-tab')
  if (fileId === null) throw new Error('File preview tab is missing')
  await compareOrRefreshGolden(expected,
    await captureStableAria(page, '[data-rightbar-col]', scaffold.workspaceCwd), webSnapshotMode())
  await column.locator('[data-dockkit-add-tab]').click()
  await column.locator('[data-sidebar-right-guide-entry="browser"]').click()
  const address = column.getByRole('textbox', { name: 'Enter an HTTP(S) address' })
  await address.fill('https://workbench.uwork.test/retained')
  await address.press('Enter')
  const frame = column.locator('[data-sidebar-browser-frame]')
  await frame.waitFor({ state: 'visible' })
  const browserInput = page.frameLocator('[data-sidebar-browser-frame]').getByRole('textbox', { name: 'Retained browser input' })
  await browserInput.fill('Keep the provider document alive')
  const browserTab = column.locator('[data-dockkit-tab][aria-selected="true"]').first()
  const browserId = await browserTab.getAttribute('data-dockkit-tab')
  if (browserId === null) throw new Error('Browser tab is missing')
  await fileTab.click()
  await expect.poll(() => preview.textContent()).toBe('source line 24\n')
  await column.locator(`[data-dockkit-tab="${browserId}"]`).click()
  // Web Browser intentionally remounts after hiding; only Desktop declares keepMounted.
  await expect.poll(() => address.inputValue()).toBe('https://workbench.uwork.test/retained')
  await page.frameLocator('[data-sidebar-browser-frame]').getByRole('heading', { name: 'Workbench browser fixture' }).waitFor()
  await browserInput.fill('Keep the provider document alive')
  const iframeNode = await frame.elementHandle()
  await column.locator('[data-sidebar-right-mode]').click()
  await expect.poll(() => column.locator('[data-sidebar-right-panel]').getAttribute('data-sidebar-right-panel')).toBe('fullscreen')
  await column.locator('[data-dockkit-split-button]').first().click()
  await expect.poll(() => column.locator('[data-dockkit-strip]').count()).toBe(2)
  expect(await browserInput.inputValue()).toBe('Keep the provider document alive')
  await mkdir(artifacts, { recursive: true })
  const captures = await mkdtemp(join(artifacts, 'run-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    for (const width of [1680, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await browserInput.inputValue()).toBe('Keep the provider document alive')
      expect(await frame.evaluate((element, original) => element === original, iframeNode)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      const visibleControls = column.locator('[data-sidebar-right-toggle]:visible')
      expect(await visibleControls.count()).toBe(1)
      const bounds = await visibleControls.boundingBox()
      if (bounds === null) throw new Error('Workbench close control is missing')
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      await page.screenshot({ path: join(captures, `${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  await fileTab.click()
  await expect.poll(() => preview.textContent()).toBe('source line 24\n')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    await page.screenshot({ path: join(captures, `${colorScheme}-file-390.png`), animations: 'disabled' })
  }
  await column.locator(`[data-dockkit-tab="${browserId}"]`).click()
  await page.frameLocator('[data-sidebar-browser-frame]').getByRole('heading', { name: 'Workbench browser fixture' }).waitFor()
  await browserInput.fill('Keep the provider document alive')
  await page.setViewportSize({ width: 1680, height: 900 })
  const file = column.locator(`[data-dockkit-tab="${fileId}"]`).first()
  await file.hover()
  await column.locator(`[data-dockkit-tab-close="${fileId}"]`).first().click()
  expect(await column.locator(`[data-dockkit-content="${fileId}"]`).count()).toBe(0)
  expect(await browserInput.inputValue()).toBe('Keep the provider document alive')
  await column.locator('[data-sidebar-right-mode]').click()
  await expect.poll(() => column.locator('[data-sidebar-right-panel]').getAttribute('data-sidebar-right-panel')).toBe('push')
  const moving = column.locator(`[data-dockkit-tab="${browserId}"]`).first()
  const tabBounds = await moving.boundingBox()
  const columnBounds = await column.boundingBox()
  if (tabBounds === null || columnBounds === null) throw new Error('Native browser drag surface is missing')
  await page.mouse.move(tabBounds.x + 6, tabBounds.y + tabBounds.height / 2)
  await page.mouse.down()
  try { await page.mouse.move(columnBounds.x - 240, tabBounds.y + tabBounds.height / 2, { steps: 8 }) }
  finally { await page.mouse.up() }
  await expect.poll(() => column.locator('[data-dockkit-float]').count()).toBe(1)
  expect(await browserInput.inputValue()).toBe('Keep the provider document alive')
  await page.screenshot({ path: join(captures, 'dark-float.png'), animations: 'disabled' })
  await column.locator('[data-dockkit-float-close]').click()
  await expect.poll(() => column.locator('[data-dockkit-float]').count()).toBe(0)

  // Match the terminal owner's POSIX shell fixture; Windows keeps the file/browser/Office checks.
  if (process.platform !== 'win32') {
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('Workbench Session is missing')
    const subprocess = agent.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('Session subprocess provider is missing')
    const handles: SubprocessTerminalHandle[] = []
    const spawn = subprocess.spawnTerminal.bind(subprocess)
    const track = vi.spyOn(subprocess, 'spawnTerminal').mockImplementation(async (spec) => {
      const handle = await spawn(spec)
      handles.push(handle)
      return handle
    })
    onTestFinished(() => { track.mockRestore() })
    await column.locator('[data-sidebar-right-guide-entry="terminal"]').getByRole('button', { name: /^New terminal/u }).click()
    const terminal = column.locator('[data-sidebar-terminal]:visible')
    const rows = column.locator('.xterm-rows:visible')
    await expect.poll(() => rows.innerText()).toContain('bash-')
    await column.locator('.xterm-helper-textarea:visible').click()
    await page.keyboard.insertText("printf 'UWORK_OK\\n'; pwd")
    await page.keyboard.press('Enter')
    await expect.poll(() => rows.innerText()).toMatch(/(?:^|\n)UWORK_OK(?:\n|$)/u)
    await expect.poll(() => rows.innerText()).toContain(scaffold.workspaceCwd)
    expect(handles).toHaveLength(1)
    const handle = handles[0]!
    const inspector = createProcessInspector()
    const identity = inspector.snapshot().tree(handle.pid).find(member => member.pid === handle.pid)
    if (identity === undefined) throw new Error('Real terminal Host process is missing')
    expect(inspector.isAlive(identity)).toBe(true)
    const terminalId = await terminal.evaluate(element => element.closest('[data-dockkit-content]')?.getAttribute('data-dockkit-content'))
    if (typeof terminalId !== 'string') throw new Error('Native terminal tab is missing')
    await column.locator('[data-dockkit-add-tab]').click()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-page]').waitFor()
    await column.locator(`[data-dockkit-tab="${terminalId}"]`).click()
    await expect.poll(() => rows.innerText()).toMatch(/(?:^|\n)UWORK_OK(?:\n|$)/u)
    expect(handles).toHaveLength(1)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
      for (const width of [1680, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await expect.poll(() => rows.innerText()).toContain('UWORK_OK')
        expect(inspector.isAlive(identity)).toBe(true)
        expect(handles).toHaveLength(1)
        await page.screenshot({ path: join(captures, `${colorScheme}-terminal-${width}.png`), animations: 'disabled' })
      }
    }
    await page.setViewportSize({ width: 1680, height: 900 })
    await column.locator('.xterm-helper-textarea:visible').click()
    await page.keyboard.insertText("printf 'UWORK_STILL_LIVE\\n'; pwd")
    await page.keyboard.press('Enter')
    await expect.poll(() => rows.innerText()).toMatch(/(?:^|\n)UWORK_STILL_LIVE(?:\n|$)/u)
    await column.locator(`[data-dockkit-tab-close="${terminalId}"]`).click()
    await expect.poll(() => inspector.isAlive(identity)).toBe(false)
    expect(await column.locator(`[data-dockkit-content="${terminalId}"]`).count()).toBe(0)
  }

  const filesTab = column.locator('[data-dockkit-tab]').filter({ hasText: 'Files' })
  if (await filesTab.count() > 0) await filesTab.click()
  else await column.locator('[data-sidebar-right-guide-entry="files"]').click()
  const navigator = column.locator('[data-files-navigator]:visible')
  await navigator.getByRole('button', { name: 'read-only-workbook.xlsx', exact: true }).click()
  const excel = column.locator('[data-excel-preview]')
  await excel.locator('.luckysheet-sheets-item-name').getByText('Preview', { exact: true }).waitFor()
  await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
  const cell = excel.locator('.fortune-fx-input')
  await expect.poll(() => cell.innerText()).toBe('Office preview 中文文档')
  await page.keyboard.insertText('EDIT_ATTEMPT')
  await page.keyboard.press('Enter')
  await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
  expect(await cell.innerText()).toBe('Office preview 中文文档')
  expect(Buffer.from(await readFile(workbookPath))).toEqual(Buffer.from(workbookBytes))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.screenshot({ path: join(captures, `${colorScheme}-office-readonly.png`), animations: 'disabled' })
  }
  const treeToggle = column.locator('[data-files-navigator-toggle]:visible')
  if (await treeToggle.getAttribute('aria-expanded') !== 'true') await treeToggle.click()
  const converted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/officeToPdf/render', { timeout: 60_000 })
  await column.locator('[data-files-navigator]:visible').getByRole('button', { name: 'read-only-document.docx', exact: true }).click()
  const conversion = await converted
  expect(conversion.headers()['content-type']).toMatch(/^multipart\/form-data;/u)
  const wordPreview = column.locator('[data-textpreview-url]:visible')
  await wordPreview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ timeout: 60_000 })
  await expect.poll(() => wordPreview.locator('[data-pdf-text]').first().textContent()).toContain('中文文档')
  expect(await wordPreview.locator('[contenteditable="true"]').count()).toBe(0)
  expect(Buffer.from(await readFile(documentPath))).toEqual(Buffer.from(documentBytes))
  await page.screenshot({ path: join(captures, 'dark-word-readonly.png'), animations: 'disabled' })
  expect(console).toEqual({ warnings: [], pageErrors: [] })
}, 180_000)
