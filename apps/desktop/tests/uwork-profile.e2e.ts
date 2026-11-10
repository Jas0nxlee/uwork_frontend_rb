/** Built Desktop profile startup and recovery without model calls or installed application data. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { desktopProduct } from '../../desktop-host/src/product.ts'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { resolveDesktopProfileBundles } from '../src/profile-bundles.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { authenticateWebHost } from '../src/web-document.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))

it('boots the configured UWork layer and preserves it after external-plugin recovery', { retry: 0 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'uwork-desktop-profile-'))
  const resources: { host?: DesktopHostProcess } = {}
  onTestFinished(async () => {
    try { await resources.host?.stop() } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
    }
  })
  const appManifest = join(repository, 'apps/desktop/package.json')
  const manifest = JSON.parse(readFileSync(appManifest, 'utf8')) as { version: string }
  const bundles = resolveDesktopProfileBundles(desktopProduct(manifest))
  expect(bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-uwork-desktop'])
  const home = join(root, 'home')
  const runtime = prepareDevelopmentProject({ projectDir: join(root, 'project'),
    cliDir: join(repository, 'apps/cli'), hostDir: join(repository, 'apps/desktop-host'),
    dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
    release: { schemaVersion: 1, version: manifest.version, nodeVersion: process.versions.node,
      pnpmVersion: (JSON.parse(readFileSync(join(repository, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8')) as { version: string }).version,
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION },
    target: process.platform === 'win32' ? 'win-x64' : 'mac-arm64', bundles, bundleAnchor: appManifest,
  })
  cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
  const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
  mkdirSync(nodeBin, { recursive: true })
  cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'))
  const paths = resolveDesktopPaths(home)
  const manager = new DesktopProjectManager(paths, { dsh: runtime }, bundles)
  await manager.applyRelease()
  const anchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
  const profile = () => loadProfileDirectory('dsh', paths.profile, anchor)
  expect(profile().skippedBundles).toEqual([])
  expect(profile().layers.map(layer => layer.packageName)).toEqual(bundles)
  const userBundle = join(paths.profile, 'node_modules', 'user-addon')
  mkdirSync(userBundle, { recursive: true })
  writeFileSync(join(userBundle, 'package.json'), JSON.stringify({ name: 'user-addon', version: '1.0.0', dsh: { bundle: { patch: './bundle.yml' } } }))
  writeFileSync(join(userBundle, 'bundle.yml'), '[]\n')
  const profileManifest = join(paths.profile, 'package.json')
  const current = JSON.parse(readFileSync(profileManifest, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
  current.dependencies['user-addon'] = '1.0.0'
  current.dsh.profile.bundles.push('user-addon')
  writeFileSync(profileManifest, JSON.stringify(current))
  const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    /^(?:path|systemroot|windir|comspec|pathext)$/iu.test(name))),
  DSH_HOME: home, HOME: home, USERPROFILE: home, DSH_TELEMETRY_MODE: 'DISABLED' }
  const boot = async () => {
    resources.host = new DesktopHostProcess(process.execPath, runtime, paths.profile, undefined, environment)
    const ready = await resources.host.start()
    expect(JSON.stringify(ready.injections)).toContain('@deepseek-ai/dsh-client-ui-uwork')
    expect(JSON.stringify(ready.injections)).not.toContain('@deepseek-ai/dsh-client-ui-brand-official')
    const cookie = await authenticateWebHost(ready.url)
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('@deepseek-ai/dsh-client-ui-uwork')
    await resources.host.stop()
  }
  await boot()
  writeFileSync(join(paths.profile, 'cordis.patch.yml'), ': broken profile patch')
  const backup = await manager.disableAllPlugins()
  expect(backup).toBeDefined()
  expect(profile().layers.map(layer => layer.packageName)).toEqual(bundles)
  expect(readFileSync(join(userBundle, 'bundle.yml'), 'utf8')).toBe('[]\n')
  await manager.applyRelease()
  await boot()
})
