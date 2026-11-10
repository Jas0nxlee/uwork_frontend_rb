/** The installed CLI uses the shared pnpm distribution with Electron's package-operation environment. */

import { delimiter, dirname, join } from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { runDesktopCli } from '../../desktop-host/src/cli.ts'
import { installOfficeEngineResolution } from '../../desktop-host/src/office-engine.ts'

vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli: vi.fn() }))
vi.mock('../../desktop-host/src/office-engine.ts', () => ({ installOfficeEngineResolution: vi.fn() }))

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

  expect(installOfficeEngineResolution).toHaveBeenCalledExactlyOnceWith(runtime)
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
