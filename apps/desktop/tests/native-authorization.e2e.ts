/** Real Electron smoke of the built private authorization carrier with a synthetic HTTPS issuer. */
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
it.skipIf(!hasDisplay)('isolates and clears real native authorization guests while callbacks stay in Main', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-authorization-'))
  try {
    const built = fileURLToPath(new URL('../lib/types/authorization-view.js', import.meta.url))
    if (!existsSync(built)) throw new Error('Build desktop Host artifacts before this smoke')
    const executable: unknown = createRequire(import.meta.url)('electron')
    if (typeof executable !== 'string') throw new Error('Electron executable unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/native-authorization-smoke.mjs', import.meta.url))
    const controller = fileURLToPath(new URL('../lib/types/native-authorization-controller.js', import.meta.url))
    const preload = fileURLToPath(new URL('./fixtures/native-authorization-smoke-preload.cjs', import.meta.url))
    const result = await execa(executable, [fixture, built, root, controller, preload], {
      env: { ELECTRON_RUN_AS_NODE: undefined }, timeout: 45_000, forceKillAfterDelay: 5_000, reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('NATIVE_AUTHORIZATION_RESULT sandboxed-node-free,memory-isolated,cancel-cleared,callback-private,owner-cleaned')
    expect(result.stdout).toContain('NATIVE_AUTHORIZATION_EXPIRY_RESULT guest-destroyed,cookies-cleared,storage-cleared')
  } finally { await rm(root, { recursive: true, force: true }) }
})
