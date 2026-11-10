/** Source-inspired surfaces through real native approval and question owners with replayed model input. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { fixtureUserPrompts, launchWebScaffold, selectedSessionFixture, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const captures = fileURLToPath(new URL('../../../.artifacts/uwork-interactions', import.meta.url))

it.each(['approval', 'question'] as const)('keeps native %s actions reachable in the UWork presentation', async (kind) => {
  const original = await selectedSessionFixture(fileURLToPath(new URL(
    `../../../snapshots/web/${kind}-composer/session.v3.jsonl`, import.meta.url)))
  const source = await readFile(original, 'utf8')
  const records = source.trimEnd().split('\n').map(line => JSON.parse(line) as {
    type: string
    data?: { messageSeqs?: number[] }
    sourceEventSeqs?: number[]
  })
  expect(records.slice(1, 4).map(record => record.type)).toEqual(['permission/preset', 'sandbox/mode', 'approval/policy'])
  // Session event sequences exclude the header: inserting at line four shifts references from sequence three.
  const shift = (seq: number) => seq >= 3 ? seq + 1 : seq
  for (const record of records) {
    if (record.type === 'session/title' && record.data?.messageSeqs !== undefined) {
      record.data.messageSeqs = record.data.messageSeqs.map(shift)
    }
    if (record.type === 'tool/result' && record.sourceEventSeqs !== undefined) {
      record.sourceEventSeqs = record.sourceEventSeqs.map(shift)
    }
  }
  const lines = records.map(record => JSON.stringify(record))
  const directory = await mkdtemp(join(tmpdir(), 'uwork-native-interaction-'))
  const resources: { browser?: Browser; scaffold?: WebScaffold } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(directory, { recursive: true, force: true }) }
    }
  })
  const fixture = join(directory, basename(original))
  // Preserve exact persisted replay comparison; add the one explicit user selection absent from the default-model fixture.
  lines.splice(4, 0, JSON.stringify({ type: 'model/selection', data: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }))
  await writeFile(fixture, lines.join('\n') + '\n')
  await writeFile(join(directory, 'snapshot.yml'), await readFile(join(dirname(original), 'snapshot.yml'), 'utf8'))
  const prompts = fixtureUserPrompts(source)
  const prompt = prompts[0]
  if (prompt === undefined) throw new Error('Missing native interaction replay prompt')
  const scaffold = await launchWebScaffold({ replayFixture: fixture, paceMs: 15,
    extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: join(bundle, 'cordis.patch.yml') })
  resources.scaffold = scaffold
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, `uwork-${kind}`))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  // The product deliberately starts without a preferred model; choose the replay route through native UI.
  const model = page.getByRole('button', { name: /^Select model(?:, current|$)/ })
  const hasSelection = (await model.getAttribute('aria-label'))?.includes(', current:') === true
  await model.click()
  // A blank selection opens directly in the model pane; a selected route first shows its root menu.
  if (hasSelection) await page.getByRole('menuitem', { name: /^Model\b/ }).click()
  await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash', exact: true }).click()
  await expect.poll(() => model.getAttribute('aria-label')).toContain('DeepSeek-V4-Flash')
  await expect.poll(() => model.getAttribute('aria-expanded')).toBe('false')
  if (kind === 'approval') {
    await page.locator('[aria-label^="Access mode"]').click()
    await page.getByRole('menuitem', { name: 'Read Only', exact: true }).click()
    await expect.poll(() => page.locator('[aria-label="Access mode, current: Read Only"]').count()).toBe(1)
  }
  await mkdir(captures, { recursive: true })
  const settled = scaffold.whenTurnSettled(90000)
  const input = page.locator('[data-composer-input]').first()
  await input.fill(prompt)
  await input.press('Enter')
  const scope = page.locator(`[data-uwork-interaction="${kind}"]`)
  const panel = scope.locator(kind === 'approval' ? '[data-approval-key]' : '[data-question-key]')
  await page.screenshot({ path: join(captures, `${kind}-after-submit.png`), animations: 'disabled' })
  try { await panel.waitFor({ timeout: 60000 }) } catch (error) {
    await page.screenshot({ path: join(captures, `${kind}-pending-failure.png`), animations: 'disabled' })
    await writeFile(join(captures, `${kind}-pending-failure.aria.txt`), await page.locator('body').ariaSnapshot())
    throw error
  }
  await mkdir(captures, { recursive: true })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const geometry = await panel.evaluate((root) => {
        const card = root.firstElementChild
        if (!(card instanceof HTMLElement)) throw new Error('Missing native interaction card')
        const bounds = card.getBoundingClientRect()
        const buttons = [...(card.lastElementChild?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        return { radius: getComputedStyle(card).borderRadius, background: getComputedStyle(card).backgroundColor,
          left: bounds.left, right: bounds.right, bottom: bounds.bottom,
          visibleActions: buttons.filter((button) => {
            const rect = button.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
          }).length, buttonCount: buttons.length }
      })
      expect(geometry.radius).toBe('16px')
      expect(geometry.background).toBe(colorScheme === 'dark' ? 'rgb(32, 32, 32)' : 'rgb(255, 255, 255)')
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(width + 1)
      expect(geometry.bottom).toBeLessThanOrEqual(901)
      expect(geometry.buttonCount).toBeGreaterThanOrEqual(2)
      expect(geometry.visibleActions).toBe(geometry.buttonCount)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await page.screenshot({ path: join(captures, `${kind}-${colorScheme}-${width}.png`), animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  if (kind === 'approval') await panel.getByRole('button', { name: 'Allow once', exact: true }).click()
  else {
    await panel.getByRole('checkbox', { name: 'Blue', exact: true }).click()
    await panel.locator('textarea').fill('Include accessibility notes')
    await panel.getByRole('button', { name: 'Submit', exact: true }).click()
  }
  await settled
  await expect.poll(() => page.locator(kind === 'approval' ? '[data-approval-key]' : '[data-question-key]').count()).toBe(0)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 150000)
