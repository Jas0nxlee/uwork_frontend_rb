/** The installed CLI uses the shared pnpm distribution with Electron's package-operation environment. */

import { delimiter, dirname, join } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { runDesktopCli, runtimeArchivePath } from '../../desktop-host/src/cli.ts'

vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it.each(['system-bin', undefined])('dispatches with bundled pnpm when PATH is %s', async (path) => {
  vi.stubEnv('PATH', path)
  const root = await mkdtemp(join(tmpdir(), 'uwork-cli-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const runtime = join(root, 'Application 中文 with spaces', 'resources', 'app.asar', 'dsh')
  await mkdir(dirname(runtime), { recursive: true })
  await writeFile(join(dirname(runtime), 'package.json'), '{}')
  const support = join('Application 中文 with spaces', 'resources', 'runtime')

  await runDesktopCli(runtime, support)

  expect(runCli).toHaveBeenCalledExactlyOnceWith({
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(support, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        PATH: `${join(support, 'bin')}${delimiter}${path ?? ''}`,
      },
    },
  })
})

it('locates the archive of an ASAR-contained runtime and leaves a prepared runtime without one', () => {
  const resources = join('Application 中文', 'resources')
  expect(runtimeArchivePath(join(resources, 'app.asar', 'dsh'))).toBe(join(resources, 'app.asar'))
  expect(runtimeArchivePath(join(resources, 'app.asar.unpacked', 'dsh'))).toBeUndefined()
  expect(runtimeArchivePath(join(resources, 'dsh'))).toBeUndefined()
})

it.each([undefined, join(tmpdir(), 'explicit-uwork-home')])('selects the product home before CLI dispatch with override %s', async (override) => {
  vi.stubEnv('DSH_HOME', override)
  const root = await mkdtemp(join(tmpdir(), 'uwork-cli-product-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const runtime = join(root, 'Application 中文 with spaces', 'resources', 'app.asar', 'dsh')
  await mkdir(dirname(runtime), { recursive: true })
  await writeFile(join(dirname(runtime), 'package.json'), await readFile(new URL('../package.json', import.meta.url)))
  vi.mocked(runCli).mockImplementationOnce(async () => {
    expect(process.env.DSH_HOME).toBe(override ?? join(homedir(), '.uwork', 'harness-preview'))
  })

  await runDesktopCli(runtime, join(root, 'runtime'))

  expect(runCli).toHaveBeenCalledOnce()
})
