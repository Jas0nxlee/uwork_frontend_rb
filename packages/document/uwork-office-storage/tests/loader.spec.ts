/** A test-owned dsh profile loads the optional Office plugin through the production launcher. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveExampleMode, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const mode = resolveExampleMode()
const entry = mode === 'lib' ? 'lib/index.js' : 'src/index.ts'
const source = new URL(`../${entry}`, import.meta.url).href
const driver = new URL('./fixtures/driver.ts', import.meta.url).href

it('loads Office file operations, preserves binary bytes, and rejects stale saves', async () => {
  const result = await runLoaderSmoke({
    label: 'UWork Office storage profile', tempDirPrefix: 'uwork-office-profile-',
    binScript: join(repo, 'apps/cli/src/bin.ts'), sourceImport: 'tsx/esm',
    configPath: source, binArgs: ['--profile', 'office-storage'],
    tsconfigPath: join(repo, 'tsconfig.json'), mode,
    prepare: async (cwd) => {
      const profile = join(cwd, '.dsh/profiles/office-storage')
      await mkdir(profile, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        name: 'office-storage-test-profile', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
      }))
      const plugin = (path: string) => pathToFileURL(join(repo, path, entry)).href
      await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
        { id: 'projections', name: plugin('packages/session/session-projection') },
        { id: 'policy', name: plugin('packages/sandbox/sandbox-policy'), config: { mode: 'workspace-write', workspaceRoot: cwd } },
        { id: 'filesystem', name: plugin('packages/fs/fs-sandbox'), config: { cwd } },
        { id: 'office-files', name: source },
        { id: 'exercise', name: driver },
      ] }]))
    },
  })
  expect(result.stdout).toContain('office-loader:UEuAAAE=')
}, 45_000)
