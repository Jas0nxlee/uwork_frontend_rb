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
import { connectFreshWorkspace, newEnglishPage, revealNavigationDrawer, saveFailureShot, writeComposerDraft } from './support.ts'

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
  const requestedModels: string[] = []
  const originalFetch = globalThis.fetch
  const fixture = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
    // External HTTPS protocol fixture only. The real app transport and unrelated requests remain real.
    if (url.origin === 'https://issuer.uwork.example.com') {
      if (url.pathname === '/api/auth/refresh') return response({ token, user: { id: 'synthetic-user', org_id: 'synthetic-org', name: 'Synthetic enterprise employee' } })
      if (url.pathname === '/api/auth/orgs') return modelFailure ? response({}, 503) : response({ llm_base_url: 'https://models.uwork.example.com' })
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
      if (url.pathname === '/api/usage/models') return response({ models: ['synthetic-model', 'synthetic-alternate'], unrestricted: false, hasSubscription: true })
      if (url.pathname === '/api/usage/stats') return response({ period: url.searchParams.get('period'), metric: url.searchParams.get('metric'), from: '2026-11-01', until: '2026-11-07', summary: { requestCount: 10, successCount: 9, successRate: 90, cost: 2, averageCost: .2, promptTokens: 15, completionTokens: 5, totalTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 }, trend: [{ date: '2026-11-06', requestCount: 4, cost: 0.8, tokens: 8 }, { date: '2026-11-07', requestCount: 6, cost: 1.2, tokens: 12 }], models: [{ model: 'synthetic-model-with-a-long-published-name-for-wrapping', requestCount: 10, cost: 2, share: 1 }] })
      return response({}, 404)
    }
    if (url.origin === 'https://models.uwork.example.com') {
      if (url.pathname === '/v1/models') return response({ data: [{ id: 'synthetic-model' }, { id: 'synthetic-alternate' }, { id: 'synthetic-hidden' }] })
      if (url.pathname === '/v1/chat/completions' && typeof init?.body === 'string') {
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-managed-key-private')
        const request = JSON.parse(init.body) as { model: string; reasoning_effort?: string; thinking?: { type: string } }
        const { model } = request
        expect(request.reasoning_effort).toBe(model === 'synthetic-model' ? 'high' : 'xhigh')
        expect(request.thinking).toEqual(model === 'synthetic-model' ? { type: 'enabled' } : undefined)
        requestedModels.push(model)
        const chunk = { id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model }
        return new Response(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: `Enterprise fixture replied using ${model}.` }, finish_reason: null }] })}\n\n`
          + `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return response({}, 404)
    }
    return originalFetch(input, init)
  })
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { fixture.mockRestore(); await rm(join(captures, 'fixture.yml'), { force: true }) }
    }
  })
  const overlay = join(captures, 'fixture.yml')
  await writeFile(overlay, `- id: uwork-enterprise\n  config:\n    apiBaseUrl: https://issuer.uwork.example.com\n    defaultOrgId: synthetic-org\n    observationIntervalMs: 20\n    organizations:\n      - orgId: synthetic-org\n        corpId: synthetic-corp\n        agentId: "123"\n        label: ${JSON.stringify(orgName)}\n        callbackUrl: https://issuer.uwork.example.com/callback\n- id: uwork-gateway-service\n  config:\n    apiBaseUrl: https://issuer.uwork.example.com\n    allowedModelEndpointOrigins: [https://models.uwork.example.com]\n- id: uwork-model-provisioning\n  config:\n    gatewayApiBaseUrl: https://issuer.uwork.example.com\n    allowedModelEndpointOrigins: [https://models.uwork.example.com]\n    preferredModels: [synthetic-model]\n    modelCatalog:\n      - id: synthetic-model\n        contextWindow: 1048576\n        maxOutputTokens: 32768\n        inputModalities: [text, image]\n        supportsTools: true\n        supportsReasoning: true\n        reasoningLevels: [low, high, max]\n        thinkingFormat: deepseek\n      - id: synthetic-alternate\n        contextWindow: 1000000\n        maxOutputTokens: 32768\n        inputModalities: [text, image]\n        supportsTools: true\n        supportsReasoning: true\n        reasoningLevels: [low, medium, high, xhigh, max]\n`)
  const scaffold = await launchWebScaffold({ extraInstallAnchors: [join(bundle, 'package.json')], extraOverlayPath: [join(bundle, 'cordis.patch.yml'), overlay], profile: { hmr: false, packages: [] } })
  resources.scaffold = scaffold
  await scaffold.ctx.credentials.modifyRecord(credentialKey('uwork-enterprise', 'identity'), async () => ({ kind: 'grant', payload: { version: 1, state: 'session', generation: randomUUID(), orgId: 'synthetic-org', userId: 'synthetic-user', token } }))
  expect((await scaffold.ctx.uworkIdentity.getState()).status).toBe('authenticated')
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser, 900)
  const console = watchConsole(page); onTestFailed(() => saveFailureShot(page, 'uwork-enterprise'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-uwork-title]').waitFor()
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
  const draft = 'Check the enterprise model route.'
  await composer.fill(draft)
  await composer.press('Enter')
  await page.getByText('Choose an available model. If the list is empty, check your account or model settings.', { exact: true }).waitFor()
  expect(await composer.innerText()).toBe(draft)
  expect(requestedModels).toEqual([])
  await page.screenshot({ path: join(captures, 'no-model-draft.png'), animations: 'disabled' })
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
  const selected = scaffold.ctx.agentDefaultModel.currentSelection()
  const modelInfo = await scaffold.ctx.llm.resolveModelInfo(selected.provider, 'synthetic-model')
  await expect(scaffold.ctx.settings.mutate('llm-pi-ai',
    [{ op: 'unset', path: ['providers', selected.provider] }])).rejects.toThrow('managed by a plugin')
  await settings.getByRole('button', { name: 'Models', exact: true }).click()
  const managedRow = settings.getByRole('listitem').filter({ hasText: 'UWork' })
  await managedRow.getByText('Enterprise managed', { exact: true }).waitFor()
  expect(await managedRow.getByRole('button', { name: /^Edit|^Delete/ }).count()).toBe(0)
  expect(await settings.getByText('DeepSeek', { exact: true }).count()).toBe(0)
  await settings.getByRole('button', { name: 'Enterprise account', exact: true }).click()
  expect(modelInfo.context?.contextWindow).toBe(1048576)
  expect(modelInfo.inputModalities).toEqual(['text', 'image'])
  expect(modelInfo.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high', 'max'])
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
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  const selector = page.getByRole('button', { name: /^Select model/ }).last()
  await expect.poll(() => selector.getAttribute('aria-label')).toContain('synthetic-model')
  await selector.click()
  await page.getByRole('menuitem', { name: /^Effort/ }).click()
  expect(await page.getByRole('menuitemradio', { name: 'Medium', exact: true }).count()).toBe(0)
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
  const firstTurn = scaffold.whenTurnSettled()
  void firstTurn.catch(() => { /* The awaited turn below reports the failure. */ })
  await composer.press('Enter')
  await page.getByText('Enterprise fixture replied using synthetic-model.', { exact: true }).waitFor()
  await firstTurn
  expect(requestedModels).toContain('synthetic-model')
  await selector.click()
  await page.getByRole('menuitem', { name: /^Model/ }).click()
  await page.getByRole('menuitemradio', { name: 'synthetic-alternate', exact: true }).waitFor()
  expect(await page.getByRole('menuitemradio', { name: 'synthetic-hidden', exact: true }).count()).toBe(0)
  await page.screenshot({ path: join(captures, 'managed-model-menu.png'), animations: 'disabled' })
  await page.getByRole('menuitemradio', { name: 'synthetic-alternate', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('button', { name: 'Enterprise account', exact: true }).click()
  await settings.getByText('synthetic-alternate', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  await expect.poll(() => selector.getAttribute('aria-label')).toContain('synthetic-alternate')
  await selector.click()
  await page.getByRole('menuitem', { name: /^Effort/ }).click()
  await page.getByRole('menuitemradio', { name: 'Xhigh', exact: true }).click()
  await writeComposerDraft(page, composer, 'Check the explicitly selected route.')
  await expect.poll(() => composer.innerText()).toBe('Check the explicitly selected route.')
  const secondTurn = scaffold.whenTurnSettled()
  void secondTurn.catch(() => { /* The awaited turn below reports the failure. */ })
  await composer.press('Enter')
  const secondSession = scaffold.ctx.sessions.get(await secondTurn)
  expect(secondSession?.requestHeader()?.config.model,
    JSON.stringify(secondSession?.snapshotEvents().findLast(event => event.type === 'turn/end')?.data)).toBe('synthetic-alternate')
  await page.getByText('Enterprise fixture replied using synthetic-alternate.', { exact: true }).waitFor()
  expect(requestedModels).toContain('synthetic-alternate')
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
  await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Enterprise usage', exact: true }).click()
  const usage = page.getByRole('region', { name: 'Enterprise usage', exact: true })
  await usage.getByText('10', { exact: true }).first().waitFor()
  await usage.getByText(orgName, { exact: true }).waitFor()
  await usage.getByText('Synthetic enterprise employee', { exact: true }).waitFor()
  expect(await usage.innerText()).not.toMatch(/synthetic-org|synthetic-user/)
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
