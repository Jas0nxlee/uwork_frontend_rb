/** UWork geometry through native conversation rendering, model menus and real attachment uploads. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-conversation/', import.meta.url))
const imagePath = fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url))

it('renders compact source surfaces while retaining native messages, tool disclosure, drafts, model menus and attachments', async () => {
  const scaffold = await launchWebScaffold({ extraInstallAnchors: [join(bundle, 'package.json')],
    extraOverlayPath: join(bundle, 'cordis.patch.yml'), profile: { hmr: false, packages: [] } })
  const resources: { browser?: Browser } = {}
  onTestFinished(async () => { try { await resources.browser?.close() } finally { await scaffold.close() } })
  const fixture = await readFile(new URL('../../../snapshots/web/tool-details/session.v3.jsonl', import.meta.url), 'utf8')
  await seedSession(scaffold, fixture, 'uwork-presentation-browser')
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'uwork-conversation'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-uwork-conversation]').waitFor()
  const group = page.getByRole('treeitem').first()
  await group.waitFor()
  await group.click()
  const session = page.getByRole('treeitem').nth(1)
  await session.waitFor()
  await session.click()
  const bubble = page.locator('[data-message-bubble]').first()
  await bubble.waitFor()
  const tool = page.locator('[data-tool="create_goal"]').first()
  await expandOwningTurnProcess(page, tool)
  await tool.waitFor()
  const disclosure = tool.getByRole('button', { expanded: false }).first()
  await disclosure.click()
  expect(await tool.getByRole('button', { expanded: true }).count()).toBeGreaterThan(0)
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
  const draft = 'Keep this unsent UWork draft and its native model selection. 企业联调输入内容 '.repeat(8).trim()
  await writeComposerDraft(page, composer, draft)
  const model = page.getByRole('button', { name: /^Select model/ }).last()
  await model.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash-Vision-Exp', exact: true }).click()
  await expect.poll(() => model.getAttribute('aria-label')).toContain('DeepSeek-V4-Flash-Vision-Exp')
  await writeComposerDraft(page, composer, '')
  const submit = page.getByRole('button', { name: 'Send message', exact: true })
  await expect.poll(() => submit.isDisabled()).toBe(true)
  expect(await submit.evaluate(element => getComputedStyle(element).opacity)).toBe('0.4')
  await writeComposerDraft(page, composer, draft)
  await expect.poll(() => submit.isEnabled()).toBe(true)
  expect(await composer.innerText()).toBe(draft)
  const filename = 'enterprise-report-长文件名验证附件操作在窄窗口仍然可达.txt'
  await page.locator('input[type="file"]').setInputFiles([
    { name: filename, mimeType: 'text/plain', buffer: Buffer.from('UWork presentation attachment') },
    { name: 'uwork-red.png', mimeType: 'image/png', buffer: await readFile(imagePath) },
  ])
  const rail = page.getByRole('group', { name: 'Pending attachments' })
  await rail.waitFor()
  await expect.poll(() => rail.locator(':scope > *').count()).toBe(2)
  const card = page.locator('[data-composer-card]').last()
  await mkdir(artifacts, { recursive: true })
  const captures = await mkdtemp(join(artifacts, 'run-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await composer.innerText()).toBe(draft)
      expect(await composer.evaluate(element => element.isConnected)).toBe(true)
      expect(await card.evaluate(element => getComputedStyle(element).borderRadius)).toBe('16px')
      expect(await card.evaluate(element => getComputedStyle(element).paddingTop)).toBe('12px')
      await expect.poll(() => submit.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(colorScheme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')
      expect(await submit.evaluate(element => getComputedStyle(element).color)).toBe(colorScheme === 'dark' ? 'rgb(15, 15, 15)' : 'rgb(255, 255, 255)')
      expect(await bubble.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px')
      expect(await bubble.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(colorScheme === 'dark' ? 'rgb(54, 54, 54)' : 'rgb(230, 230, 230)')
      expect(await rail.locator(':scope > *').evaluateAll(items => items.every(item => Math.abs(item.getBoundingClientRect().height - 48) < 1))).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      const bounds = await card.boundingBox()
      if (bounds === null) throw new Error('Native composer is missing')
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1)
      await page.screenshot({ path: join(captures, `${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await submit.hover()
  await expect.poll(() => submit.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(229, 229, 229)')
  await page.mouse.move(0, 0)
  await bubble.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(captures, 'dark-message-tool.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Remove image uwork-red.png', exact: true }).click()
  await expect.poll(() => rail.locator(':scope > *').count()).toBe(1)
  expect(await composer.innerText()).toBe(draft)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 120000)
it('retains native queueing, focus and keyboard stop while applying submit colors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uwork-conversation-running-'))
  const marker = join(directory, 'ready')
  const override = join(directory, 'override.json')
  await writeFile(override, JSON.stringify({ patches: [{ at: 0, entry: { kind: 'hang', readyFile: marker } }] }))
  const fixture = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride: override, compareReplaySession: false,
    extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: join(bundle, 'cordis.patch.yml'),
    profile: { hmr: false, packages: [] } })
  const resources: { browser?: Browser; page?: Page; settled?: Promise<unknown> } = {}
  onTestFinished(async () => {
    try {
      if (resources.page !== undefined && resources.settled !== undefined) {
        await resources.page.keyboard.press('Escape')
        await resources.page.keyboard.press('Escape')
        await resources.settled
      }
    } finally {
      try { await resources.browser?.close() } finally {
        try { await scaffold.close() } finally { await rm(directory, { recursive: true, force: true }) }
      }
    }
  })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  resources.page = page
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-uwork-conversation]').waitFor()
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const model = page.getByRole('button', { name: /^Select model/ }).last()
  await model.click()
  await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash', exact: true }).click()
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
  const settled = scaffold.whenTurnSettled()
  resources.settled = settled
  void settled.catch(() => {})
  await writeComposerDraft(page, composer, 'Reply with a one-sentence description of event sourcing, then stop.')
  await composer.press('Enter')
  await expect.poll(() => existsSync(marker), { timeout: 15000 }).toBe(true)
  await expect.poll(() => composer.innerText()).toBe('')
  const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
  await stop.waitFor()
  await mkdir(artifacts, { recursive: true })
  const captures = await mkdtemp(join(artifacts, 'running-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: colorScheme === 'dark' ? 390 : 1280, height: 900 })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    await expect.poll(() => stop.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(colorScheme === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')
    expect(await stop.isEnabled()).toBe(true)
    await page.screenshot({ path: join(captures, `${colorScheme}-stop.png`), animations: 'disabled' })
  }
  await writeComposerDraft(page, composer, 'Retain this native queued draft through the UWork presentation layer 企业队列')
  await page.getByRole('button', { name: 'Queue message', exact: true }).click()
  const queue = page.locator('[data-queue-dock]').getByRole('listitem').filter({ hasText: 'Retain this native queued draft' })
  await queue.waitFor()
  await expect.poll(() => composer.innerText()).toBe('')
  await page.screenshot({ path: join(captures, 'dark-queued.png'), animations: 'disabled' })
  await queue.getByRole('button', { name: 'Remove queued message', exact: true }).click()
  await queue.waitFor({ state: 'hidden' })
  await stop.focus()
  await stop.press('Enter')
  await settled
  await stop.waitFor({ state: 'hidden' })
  expect(await page.locator('[data-uwork-composer]').count()).toBe(1)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 120000)
