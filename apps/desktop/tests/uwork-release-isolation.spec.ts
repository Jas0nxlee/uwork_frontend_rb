import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadDesktopTarget } from '../scripts/upload-target.ts'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { describe, expect, it } from 'vitest'
import { resolveDesktopAutoUpdateConfig } from '../scripts/desktop-auto-update-environment.mjs'

const product = { artifactStem: 'uwork-next' }
const environment = {
  DOWNLOAD_TEST_ORIGIN: 'https://preview.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
}

describe('UWork Preview release isolation', () => {
  it('uses independent feed and binary prefixes for both supported platforms', () => {
    for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64']] as const) {
      const update = resolveDesktopAutoUpdateConfig(environment, platform, arch, product)
      expect(update.keyPrefix).toMatch(/^uwork-next\/[a-f0-9]{32}\/feeds\//u)
      expect(update.binaryKeyPrefix).toMatch(/^uwork-next\/[a-f0-9]{32}\/bin\//u)
      expect(update.publicUrl).not.toContain('dsh-desk')
    }
  })
  it('rejects legacy production and DeepSeek test origins', () => {
    expect(() => resolveDesktopAutoUpdateConfig({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' }, 'win32', 'x64', product)).toThrow('legacy production')
    for (const origin of ['https://download.deepseek.com', 'https://deepseek.com', 'https://download.deepseek.com.']) {
      expect(() => resolveDesktopAutoUpdateConfig({ ...environment, DOWNLOAD_TEST_ORIGIN: origin }, 'darwin', 'arm64', product)).toThrow('independent update origin')
    }
  })
  it('rejects legacy website replacement before artifact reads or network access', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uwork-release-'))
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ dshDesktopProduct: product }))
      await expect(createDesktopUploadPlan('win-x64', {
        appRoot: directory, packagedProductVersion: '0.2.2', environment, latest: true,
      })).rejects.toThrow('cannot replace legacy website installers')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps retained Preview production and legacy-origin guards without a checkout manifest', async () => {
    for (const updateEnvironment of [
      { DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' },
      { ...environment, DOWNLOAD_TEST_ORIGIN: 'https://download.deepseek.com' },
    ]) {
      await expect(createDesktopUploadPlan('win-x64', {
        appRoot: '/absent-retained-checkout', packagedProductVersion: '0.2.2',
        packagedDistribution: product, environment: updateEnvironment,
      })).rejects.toThrow(/legacy production|independent update origin/u)
    }
  })
  it('rejects legacy upload and purge commands before loading release credentials', async () => {
    for (const args of [['win-x64', '--latest'], ['mac-arm64', '--latest', '--purge-only']]) {
      await expect(uploadDesktopTarget(args)).rejects.toThrow('cannot replace or purge legacy website installers')
    }
  })
  it('retains existing dsh deployment paths without a UWork product selection', () => {
    expect(resolveDesktopAutoUpdateConfig(environment, 'win32', 'x64').keyPrefix).toMatch(/^dsh-desk\//u)
    expect(resolveDesktopAutoUpdateConfig({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' }, 'darwin', 'arm64').origin).toBe('https://download.deepseek.com')
  })
})
