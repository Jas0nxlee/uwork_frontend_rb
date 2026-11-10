/** Signed-out enterprise usage through the real product bundle, generated Remote, resources and native slots. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage, openSettings, revealNavigationDrawer, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-enterprise-usage/', import.meta.url))

async function openUsage(page: Page): Promise<void> {
  await revealNavigationDrawer(page, 'en')
  const direct = page.getByRole('button', { name: 'Enterprise usage', exact: true })
  if (await direct.isVisible()) {
    await direct.focus()
    await direct.press('Enter')
  } else {
    const more = page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'More', exact: true })
    await more.focus()
    await more.press('Enter')
    const entry = page.getByRole('menuitem', { name: 'Enterprise usage', exact: true })
    await entry.focus()
    await entry.press('Enter')
  }
  await page.getByRole('heading', { name: 'Enterprise usage', exact: true }).waitFor()
}

it('opens enterprise usage and Settings with keyboard navigation, light/dark themes and narrow layouts', async () => {
  const scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: join(bundle, 'cordis.patch.yml'),
    profile: { hmr: false, packages: [] },
  })
  const resources: { browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await scaffold.close() }
  })
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'uwork-enterprise-usage'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-uwork-title]').waitFor()
  await mkdir(artifacts, { recursive: true })
  const captureDir = await mkdtemp(join(artifacts, 'signed-out-run-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await openUsage(page)
      const panel = page.getByRole('region', { name: 'Enterprise usage', exact: true })
      await panel.getByText('Sign in to an enterprise account to view usage.', { exact: true }).waitFor()
      expect(await panel.getByText('Success rate', { exact: true }).count()).toBe(0)
      expect(await panel.getByRole('table').count()).toBe(0)
      const period = panel.getByRole('combobox', { name: /^Period/ })
      await period.focus()
      await period.selectOption('30d')
      const metric = panel.getByRole('combobox', { name: /^Metric/ })
      await metric.focus()
      await metric.selectOption('tokens')
      const refresh = panel.getByRole('button', { name: 'Refresh', exact: true })
      await refresh.focus()
      await refresh.press('Enter')
      await panel.getByText('Sign in to an enterprise account to view usage.', { exact: true }).waitFor()
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const box = await refresh.boundingBox()
      if (box === null) throw new Error('Usage refresh action is not rendered')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: join(captureDir, `${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await revealNavigationDrawer(page, 'en')
  const directSettings = page.getByRole('button', { name: 'Settings', exact: true })
  if (await directSettings.isVisible()) {
    await directSettings.focus()
    await directSettings.press('Enter')
  } else await openSettings(page, 'en')
  const settings = page.locator('[data-shortcut-modal="settings"]')
  await settings.waitFor()
  const general = settings.getByRole('button', { name: 'General', exact: true })
  await general.focus()
  await general.press('Enter')
  await settings.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('menuitem', { name: '中文', exact: true }).click()
  await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('zh-CN')
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 900 })
  const chinese = page.getByRole('region', { name: '企业用量', exact: true })
  await chinese.getByText('登录企业账号后查看用量', { exact: true }).waitFor()
  const chineseRefresh = chinese.getByRole('button', { name: '刷新', exact: true })
  await chineseRefresh.focus()
  await chineseRefresh.press('Enter')
  await chinese.getByText('登录企业账号后查看用量', { exact: true }).waitFor()
  expect(await chinese.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: join(captureDir, 'zh-dark-390.png'), animations: 'disabled' })
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 180_000)
