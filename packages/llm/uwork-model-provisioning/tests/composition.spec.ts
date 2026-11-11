import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Llm from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Provisioning from '../src/index.ts'

it('boots a real profile, commits secret-free native model settings and recovers after restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uwork-provision-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test'); initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle'); await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
    { id: 'credentials', name: 'cordis:credentials', config: { dshHome: home, watch: false } },
    { id: 'llm', name: 'cordis:llm' },
    { id: 'llm-pi-ai', name: 'cordis:pi', config: { providers: { personal: { api: 'openai-completions', apiKeyEnv: 'PERSONAL_KEY', baseURL: 'https://personal.example/v1', models: [{ id: 'mine' }] } } } },
    { id: 'model', name: 'cordis:model', config: { provider: 'personal', model: 'mine' } },
    { id: 'provisioning', name: 'cordis:provisioning' },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = { name: 'test', startedBundles: ['test-bundle'], dir,
    patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home,
    overlays: [], telemetryDisabledEnv: undefined }
  const start = () => boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, credentials: Credentials,
      llm: Llm, pi: PiAi, model: DefaultModel, provisioning: Provisioning })
  })
  const ctx = await start(); onTestFinished(() => ctx.fiber.dispose())
  await ctx.uworkModelProvisioning.provision({ binding: { orgId: 'org', userId: 'user', generation: 'one' },
    provider: 'uwork-one', credentialRef: 'UWORK_ONE', endpoint: 'https://gateway.example/v1', apiKey: 'enterprise-secret-fixture',
    authorizedModels: ['allowed'], capabilities: [{ id: 'allowed', contextWindow: 8192, maxTokens: 1024, input: ['text'] }],
    preferredModels: ['allowed'], signal: new AbortController().signal })
  const descriptor = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')!
  expect(descriptor.readOnlyPaths).toEqual([['providers', 'uwork-one']])
  await expect(ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', 'uwork-one'] }]))
    .rejects.toThrow('managed by a plugin')
  await expect(ctx.settings.update('llm-pi-ai', { providers: { 'uwork-one': { displayName: 'edited' } } }))
    .rejects.toThrow('managed by a plugin')
  const value = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')!.value
  expect(JSON.stringify(value)).toContain('UWORK_ONE'); expect(JSON.stringify(value)).not.toContain('enterprise-secret-fixture')
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'personal', model: 'mine' })
  const resolve = vi.spyOn(ctx.credentials, 'resolve')
  const fetchModel = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected model discovery I/O'))
  onTestFinished(() => { resolve.mockRestore(); fetchModel.mockRestore() })
  for (const baseURL of ['https://gateway.example/v1', 'https://foreign.example/v1']) {
    await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'uwork-one', baseURL, api: 'openai-completions' }))
      .rejects.toMatchObject({ code: 'REVOKED' })
  }
  ctx.uworkModelProvisioning.revoke()
  await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'uwork-one', baseURL: 'https://foreign.example/v1', apiKey: 'one-shot-fixture' }))
    .rejects.toMatchObject({ code: 'REVOKED' })
  expect(resolve).not.toHaveBeenCalled(); expect(fetchModel).not.toHaveBeenCalled()
  fetchModel.mockResolvedValue(Response.json({ data: [{ id: 'personal-discovered' }] }))
  expect(await ctx.llm.discoverModels('llm-pi-ai', { provider: 'personal', baseURL: 'https://personal.example/v1',
    api: 'openai-completions', apiKey: 'personal-one-shot-fixture' })).toEqual([{ id: 'personal-discovered', name: 'personal-discovered' }])
  expect(fetchModel).toHaveBeenCalledOnce()
  resolve.mockRestore(); fetchModel.mockRestore()
  expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).toContain('enterprise-secret-fixture')
  await ctx.fiber.dispose()
  const restarted = await start(); onTestFinished(() => restarted.fiber.dispose())
  await restarted.uworkModelProvisioning.recover()
  expect(JSON.stringify(restarted.settings.describe().find(row => row.ns === 'llm-pi-ai')!.value)).not.toContain('UWORK_ONE')
  expect(await readFile(join(home, '.credentials.yaml'), 'utf8')).not.toContain('enterprise-secret-fixture')
})
