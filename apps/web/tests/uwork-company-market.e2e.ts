/** UWork's company catalog through real Host, generated Remote and Plugins tab composition. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, revealNavigationDrawer, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const expected = fileURLToPath(new URL('./expected/uwork-company-market/catalog.expected.md', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-company-market/', import.meta.url))

it('browses anonymously, searches every upstream page and retains results after a failed refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uwork-market-browser-'))
  const resources: { browser?: Browser; scaffold?: WebScaffold } = {}
  let unavailable = false
  let authorizedRequests = 0
  const items = [
    { slug: 'weather', displayName: 'Weather', summary: 'Forecasts for travel and planning', latestVersion: { version: '1.0.0' } },
    { slug: 'video-frames', displayName: 'Video frames', summary: 'Extract video frames', latestVersion: { version: '2.0.0' } },
    { slug: 'company--long-title', displayName: 'Company archive with a long title 企业技能目录长名称用于检查窄窗口中的换行与操作可达性', summary: 'Archive documents with a long description that must wrap inside the company skill card without hiding the page controls.', latestVersion: { version: '2026.11.10' } },
  ]
  const server = createServer((request, response) => {
    if (request.headers.authorization !== undefined) authorizedRequests++
    response.setHeader('content-type', 'application/json')
    if (unavailable) { response.writeHead(429); response.end('{"error":"rate limited"}'); return }
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/skillhub/.well-known/clawhub.json') {
      response.end('{"apiBase":"/skillhub/api/v1"}'); return
    }
    if (url.pathname === '/skillhub/api/v1/skills') {
      const page = Number(url.searchParams.get('page'))
      response.end(JSON.stringify({ items: items.slice(page * 2, page * 2 + 2), nextCursor: page === 0 ? '1' : null })); return
    }
    response.writeHead(404); response.end('{}')
  })
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally {
        try {
          server.closeAllConnections()
          if (server.listening) await new Promise<void>((resolve, reject) => {
            server.close((error) => { if (error) reject(error); else resolve() })
          })
        } finally { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }) }
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Company market fixture has no TCP address')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const overlay = join(root, 'market.yml')
  await writeFile(overlay, `- id: uwork-company-market\n  config:\n    baseUrl: ${origin}/skillhub\n    upstreamPageSize: 2\n    resultPageSize: 2\n`)
  resources.scaffold = await launchWebScaffold({
    extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: [join(bundle, 'cordis.patch.yml'), overlay],
    profile: { hmr: false, packages: [] },
  })
  resources.browser = await chromium.launch()
  const page = await newEnglishPage(resources.browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'uwork-company-market'))
  await page.goto(resources.scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('tab', { name: 'Company market', exact: true }).click()
  const market = page.getByRole('region', { name: 'Company market', exact: true })
  await market.getByText('Skills: 3', { exact: true }).waitFor()
  expect(await market.getByText('Weather', { exact: true }).isVisible()).toBe(true)
  await compareOrRefreshGolden(expected,
    (await captureStableAria(page, 'section[aria-label="Company market"]', resources.scaffold.workspaceCwd)).replaceAll(origin, 'https://company.example'),
    webSnapshotMode())
  await market.getByRole('button', { name: 'Next', exact: true }).click()
  await market.getByText(items[2]!.displayName, { exact: true }).waitFor()
  await mkdir(artifacts, { recursive: true })
  const captures = await mkdtemp(join(artifacts, 'run-'))
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expect.poll(() => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))).toBe(colorScheme === 'dark')
    for (const width of [1680, 760]) {
      await page.setViewportSize({ width, height: 900 })
      const bounds = await market.getByText(items[2]!.displayName, { exact: true }).boundingBox()
      if (bounds === null) throw new Error('Company skill title is not rendered')
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      expect(await market.getByRole('button', { name: 'Previous', exact: true }).isVisible()).toBe(true)
      await page.screenshot({ path: join(captures, `${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  const search = market.getByRole('textbox', { name: 'Search company skills', exact: true })
  await search.fill('weather')
  await search.press('Enter')
  await market.getByText('Skills: 1', { exact: true }).waitFor()
  expect(await market.getByText('Video frames', { exact: true }).count()).toBe(0)
  unavailable = true
  await market.getByRole('button', { name: 'Refresh', exact: true }).click()
  await market.getByRole('alert').waitFor()
  expect(await market.getByText('Weather', { exact: true }).isVisible()).toBe(true)
  expect(await market.getByText('Showing previous results', { exact: true }).isVisible()).toBe(true)
  unavailable = false
  await market.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => market.getByRole('alert').count()).toBe(0)
  await search.fill('missing')
  await search.press('Enter')
  await market.getByText('No skills found', { exact: true }).waitFor()
  const chinese = await resources.browser.newPage({ viewport: { width: 760, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  await chinese.emulateMedia({ colorScheme: 'dark' })
  await chinese.goto(resources.scaffold.authenticatedUrl, { waitUntil: 'load' })
  await revealNavigationDrawer(chinese, 'zh')
  await chinese.getByRole('button', { name: '插件', exact: true }).click()
  await chinese.getByRole('tab', { name: '公司市场', exact: true }).click()
  const chineseMarket = chinese.getByRole('region', { name: '公司市场', exact: true })
  await chineseMarket.getByText('3 个技能', { exact: true }).waitFor()
  expect(await chineseMarket.getByRole('textbox', { name: '搜索公司技能', exact: true }).isVisible()).toBe(true)
  await chinese.screenshot({ path: join(captures, 'zh-dark-760.png'), animations: 'disabled' })
  expect(authorizedRequests).toBe(0)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 120_000)
