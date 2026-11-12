/** UWork's opt-in profile layer through real Client artifacts and Cordis registrations. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, revealNavigationDrawer, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const expected = fileURLToPath(new URL('./expected/uwork-brand/home.expected.md', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-brand/', import.meta.url))

it('shows UWork and UCAS in both themes and keeps branding usable in a narrow desktop window', async () => {
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: join(bundle, 'cordis.patch.yml'),
    profile: { hmr: false, packages: [] },
  })
  const resources: { browser: Browser | undefined } = { browser: undefined }
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await scaffold.close() }
  })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'uwork-brand'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-uwork-title]').waitFor()
  expect(await page.locator('[data-uwork-name]').getAttribute('aria-label')).toBe('UWork')
  expect(await page.locator('[data-uwork-mark]').count()).toBe(2)
  expect(await page.locator('[data-home-whale]').count()).toBe(0)
  expect(await page.locator('[data-uwork-home-background]').getAttribute('data-uwork-home-background')).toBe('UCAS')
  await page.getByRole('button', { name: 'Standard mode', exact: true }).waitFor()
  await compareOrRefreshGolden(expected,
    await captureStableAria(page, '[data-conversation-content]', scaffold.workspaceCwd), webSnapshotMode())
  await mkdir(artifacts, { recursive: true })
  const captureDir = await mkdtemp(join(artifacts, 'run-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')))
      .toBe(colorScheme === 'dark')
    await expect.poll(() => page.locator('body').evaluate(element =>
      getComputedStyle(element).getPropertyValue('--dsw-alias-bg-base').trim()))
      .toBe(colorScheme === 'dark' ? '#0f0f0f' : '#f5f5f5')
    for (const width of [1680, 1000]) {
      await page.setViewportSize({ width, height: 900 })
      const title = page.locator('[data-uwork-title]')
      expect(await title.isVisible()).toBe(true)
      const bounds = await title.boundingBox()
      if (bounds === null) throw new Error('UWork title is not rendered')
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(await title.evaluate(element => getComputedStyle(element).maskImage)).toContain('/assets/')
      await page.screenshot({ path: join(captureDir, `${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  // Use the assembled native navigation, composer and menus with wrapping content.
  await page.setViewportSize({ width: 1680, height: 900 })
  await expect.poll(() => page.locator('[data-uwork-navigation="compact"]').count()).toBe(1)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
  const draft = 'Review the enterprise workspace without losing this unsent draft. '.repeat(12).trim()
  await composer.fill(draft)
  await page.locator('[data-sidebar-toggle]').click()
  await expect.poll(() => page.locator('[data-uwork-navigation="rail"]').count()).toBe(1)
  await page.locator('[data-sidebar-toggle]').click()
  await expect.poll(() => page.locator('[data-uwork-navigation="compact"]').count()).toBe(1)
  expect(await composer.innerText()).toBe(draft)
  const more = page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'More', exact: true })
  await more.focus()
  await more.press('Enter')
  await expect.poll(() => more.getAttribute('aria-expanded')).toBe('true')
  await page.keyboard.press('Escape')
  await expect.poll(() => more.getAttribute('aria-expanded')).toBe('false')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await revealNavigationDrawer(page, 'en')
      await expect.poll(() => page.locator('[data-uwork-navigation="drawer"]').count()).toBe(1)
      const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true })
      await drawer.waitFor()
      await page.screenshot({ path: join(captureDir, `${colorScheme}-${width}-drawer-long-draft.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      await drawer.waitFor({ state: 'hidden' })
      expect(await composer.innerText()).toBe(draft)
      await page.screenshot({ path: join(captureDir, `${colorScheme}-${width}-long-draft.png`), animations: 'disabled' })
    }
  }
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 120_000)
