/** Real UWork Client/Host composition with a labeled synthetic HTTPS issuer fixture. */
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-uwork-enterprise'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, revealNavigationDrawer, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/uwork-desktop', import.meta.url))
const artifacts = fileURLToPath(new URL('../../../.artifacts/uwork-enterprise/', import.meta.url))
const orgName = '联合研究实验室 / Enterprise Research Organization with a long name'

it('verifies an account, confirms server key creation, and withdraws identity across browser windows', async () => {
  await mkdir(artifacts, { recursive: true })
  const captures = await mkdtemp(join(artifacts, 'run-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.synthetic-signature`
  let keyAlias: string | undefined
  let creates = 0
  let modelFailure = false
  const originalFetch = globalThis.fetch
  const fixture = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
    // External HTTPS protocol fixture only. The real app transport and unrelated requests remain real.
    if (url.origin === 'https://issuer.uwork.example.com') {
      if (url.pathname === '/api/auth/refresh') return response({ token, user: { id: 'synthetic-user', org_id: 'synthetic-org', name: 'Synthetic enterprise employee' } })
      if (url.pathname === '/api/auth/orgs') return modelFailure ? response({}, 503) : response({ llm_base_url: 'https://models.uwork.example.com/v1' })
      if (url.pathname === '/api/keys/generate') {
        creates += 1
        if (typeof init?.body !== 'string') throw new Error('Synthetic key creation requires a JSON body')
        const body = JSON.parse(init.body) as { alias: string }
        keyAlias = body.alias
        return response({ id: 1, key: 'synthetic-managed-key-private', masked_key: 'synthetic-mask', status: 'active' })
      }
      if (url.pathname === '/api/keys') return response({ keys: keyAlias === undefined ? [] : [{ id: 1, alias: keyAlias, masked_key: 'synthetic-mask', status: 'active' }] })
      if (url.pathname === '/api/keys/1/reveal') return response({ key: 'synthetic-managed-key-private' })
      if (url.pathname === '/api/usage') return response({ subscriptions: [] })
      if (url.pathname === '/api/usage/models') return response({ models: ['synthetic-model'], unrestricted: false, hasSubscription: true })
      if (url.pathname === '/api/usage/stats') return response({ period: url.searchParams.get('period'), metric: url.searchParams.get('metric'), from: '2026-11-01', until: '2026-11-07', summary: { requestCount: 10, successCount: 9, successRate: 90, cost: 2, averageCost: .2, promptTokens: 15, completionTokens: 5, totalTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 }, trend: [{ date: '2026-11-06', requestCount: 4, cost: 0.8, tokens: 8 }, { date: '2026-11-07', requestCount: 6, cost: 1.2, tokens: 12 }], models: [{ model: 'synthetic-model-with-a-long-published-name-for-wrapping', requestCount: 10, cost: 2, share: 1 }] })
      return response({}, 404)
    }
    if (url.origin === 'https://models.uwork.example.com' && url.pathname === '/v1/models') return response({ data: [{ id: 'synthetic-model', context_window: 128000, max_output_tokens: 8192, input_modalities: ['text'], supports_tools: true, supports_reasoning: false }] })
    return originalFetch(input, init)
  })
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { fixture.mockRestore(); await rm(join(captures, 'fixture.yml'), { force: true }) }
    }
  })
  const overlay = join(captures, 'fixture.yml')
  await writeFile(overlay, `- id: uwork-enterprise\n  config:\n    apiBaseUrl: https://issuer.uwork.example.com\n    defaultOrgId: synthetic-org\n    observationIntervalMs: 20\n    organizations:\n      - orgId: synthetic-org\n        corpId: synthetic-corp\n        agentId: "123"\n        label: ${JSON.stringify(orgName)}\n        callbackUrl: https://issuer.uwork.example.com/callback\n- id: uwork-gateway-service\n  config:\n    apiBaseUrl: https://issuer.uwork.example.com\n    allowedModelEndpointOrigins: [https://models.uwork.example.com]\n- id: uwork-model-provisioning\n  config:\n    gatewayApiBaseUrl: https://issuer.uwork.example.com\n    allowedModelEndpointOrigins: [https://models.uwork.example.com]\n    preferredModels: []\n`)
  const scaffold = await launchWebScaffold({ extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: [join(bundle, 'cordis.patch.yml'), overlay], profile: { hmr: false, packages: [] } })
  resources.scaffold = scaffold
  await scaffold.ctx.credentials.modifyRecord(credentialKey('uwork-enterprise', 'identity'), async () => ({ kind: 'grant', payload: { version: 1, state: 'session', generation: randomUUID(), orgId: 'synthetic-org', userId: 'synthetic-user', token } }))
  expect((await scaffold.ctx.uworkIdentity.getState()).status).toBe('authenticated')
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page); onTestFailed(() => saveFailureShot(page, 'uwork-enterprise'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Enterprise account', exact: true }).click()
  await settings.getByText('Synthetic enterprise employee', { exact: true }).waitFor()
  const create = settings.getByRole('button', { name: 'Create managed key', exact: true })
  await create.waitFor(); expect(creates).toBe(0)
  await create.click()
  await page.getByRole('dialog', { name: 'Create a managed key?' }).getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(creates).toBe(0)
  await create.click()
  const confirm = page.getByRole('dialog', { name: 'Create a managed key?' }).getByRole('button', { name: 'Create key on server', exact: true })
  await confirm.focus(); await confirm.press('Enter')
  await settings.getByText('synthetic-model', { exact: true }).waitFor()
  expect(creates).toBe(1)
  expect(await settings.innerText()).not.toContain('synthetic-managed-key-private')
  expect(await settings.innerText()).not.toContain(token)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.screenshot({ path: join(captures, `${colorScheme}-1680-account.png`), animations: 'disabled' })
  }
  modelFailure = true
  await settings.getByRole('button', { name: 'Refresh models', exact: true }).click()
  await settings.getByText('Could not verify managed models. Refresh and try again.', { exact: true }).waitFor()
  modelFailure = false
  await settings.getByRole('button', { name: 'Refresh models', exact: true }).click()
  await settings.getByText('synthetic-model', { exact: true }).waitFor()
  expect(creates).toBe(1)
  const chinese = await browser.newPage({ viewport: { width: 390, height: 900 }, locale: 'zh-CN' })
  await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await revealNavigationDrawer(chinese, 'zh')
  await chinese.getByRole('button', { name: '设置', exact: true }).click()
  const zhSettings = chinese.getByRole('dialog', { name: '设置', exact: true })
  await zhSettings.getByRole('button', { name: '企业账户', exact: true }).click()
  await zhSettings.getByText('Synthetic enterprise employee', { exact: true }).waitFor()
  await zhSettings.getByText('synthetic-model', { exact: true }).waitFor()
  for (const colorScheme of ['light', 'dark'] as const) {
    await chinese.emulateMedia({ colorScheme })
    await chinese.screenshot({ path: join(captures, `${colorScheme}-390-zh-account.png`), animations: 'disabled' })
  }
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Enterprise usage', exact: true }).click()
  const usage = page.getByRole('region', { name: 'Enterprise usage', exact: true })
  await usage.getByText('10', { exact: true }).first().waitFor()
  await usage.getByRole('img', { name: 'Daily usage', exact: true }).waitFor()
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.screenshot({ path: join(captures, `${colorScheme}-1680-authenticated-usage.png`), animations: 'disabled' })
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('button', { name: 'Enterprise account', exact: true }).click()
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click()
  await settings.getByText('Return to the sign-in window to continue.', { exact: true }).waitFor()
  await zhSettings.getByText('请返回登录窗口继续', { exact: true }).waitFor()
  expect(await zhSettings.getByText('Synthetic enterprise employee', { exact: true }).count()).toBe(0)
  expect(await zhSettings.getByRole('heading', { name: 'UWork 受管模型', exact: true }).count()).toBe(0)
  expect(creates).toBe(1)
  expect(console.pageErrors).toEqual([])
  expect(console.warnings).toEqual([])
}, 180_000)
