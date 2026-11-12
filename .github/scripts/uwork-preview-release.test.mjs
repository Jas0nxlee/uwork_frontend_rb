import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, 'uwork-preview-release.mjs')
const version = '0.2.2-rc.1.20261111.8'
const commit = 'a'.repeat(40)

for (const ref of ['refs/heads/master', 'refs/heads/integrate/dsh-v0.2.2-rc.1']) {
  test(`publishes only matching nonempty installers from one source commit on ${ref}`, t => {
    const cwd = mkdtempSync(join(tmpdir(), 'uwork-preview-release-'))
    t.after(() => rmSync(cwd, { recursive: true, force: true }))
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '0.2.2-rc.1' }))
    const run = (mode, extra = {}) => spawnSync(process.execPath, [script, mode], {
      cwd, encoding: 'utf8', env: { ...process.env, GITHUB_REF: ref, GITHUB_SHA: commit, BUILD_VERSION: version, ...extra },
    })
    assert.equal(run('prepare').status, 0)
    assert.notEqual(run('prepare', { GITHUB_REF: 'refs/heads/feature' }).status, 0)
    assert.notEqual(run('prepare', { GITHUB_REF: 'refs/heads/integrate/dsh-v0.2.2-rc.2' }).status, 0)
    assert.notEqual(run('prepare', { GITHUB_REF: 'refs/tags/dsh-v0.2.2-rc.1' }).status, 0)
    assert.notEqual(run('prepare', { BUILD_VERSION: '../../unsafe' }).status, 0)
    assert.notEqual(run('prepare', { GITHUB_SHA: 'short' }).status, 0)
    assert.notEqual(run('collect', { PACKAGE_TARGET: 'linux' }).status, 0)
    assert.notEqual(run('collect', { PACKAGE_TARGET: 'win-x64' }).status, 0)
    for (const [target, ext] of [['mac-arm64', 'dmg'], ['win-x64', 'exe']]) {
      const path = join(cwd, 'apps/desktop/.desktop-build/targets', target, 'unsigned-artifacts', `uwork-next-${version}-${target}-unsigned.${ext}`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '')
      assert.notEqual(run('collect', { PACKAGE_TARGET: target }).status, 0)
      writeFileSync(path, `Synthetic installer for ${target}`)
      assert.equal(run('collect', { PACKAGE_TARGET: target }).status, 0)
    }
    assert.equal(run('verify').status, 0)
    const sums = readFileSync(join(cwd, '.artifacts/uwork-preview/SHA256SUMS'), 'utf8')
    assert.equal(sums.trim().split('\n').length, 2)
    assert.notEqual(run('verify', { GITHUB_SHA: 'b'.repeat(40) }).status, 0)
    writeFileSync(join(cwd, '.artifacts/uwork-preview', `uwork-next-${version}-win-x64-unsigned.exe`), 'modified')
    assert.notEqual(run('verify').status, 0)
  })
}
