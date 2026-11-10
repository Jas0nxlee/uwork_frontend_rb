/** Real Loader/YAML composition and durable credential store; only the external issuer is synthetic. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Authorization from '@deepseek-ai/dsh-authorization'
import NativeAuthorization from '@deepseek-ai/dsh-native-authorization'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import Enterprise from '../src/index.ts'

it('boots from a test-only cordis.yml, verifies recovery with the issuer and durably revokes on logout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'uwork-identity-composition-'))
  const contexts: Context[] = []
  onTestFinished(async () => {
    await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
    await rm(directory, { force: true, recursive: true })
    vi.unstubAllGlobals()
  })
  const credentialPath = join(directory, 'credentials.yaml')
  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'credentials', name: 'cordis:credentials', config: { path: credentialPath, watch: false } },
    { id: 'authorization', name: 'cordis:authorization' },
    { id: 'native', name: 'cordis:native' },
    { id: 'identity', name: 'cordis:enterprise', config: { apiBaseUrl: 'https://issuer.example', organizations: [{ orgId: 'org', corpId: 'corporation', agentId: '1', callbackUrl: 'https://issuer.example/callback' }], defaultOrgId: 'org' } },
  ]))
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.synthetic`
  const external = vi.fn<typeof fetch>(async (input) => {
    if (new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).pathname.endsWith('/handoff/start')) return new Response(JSON.stringify({ handoff_id: 'synthetic-attempt', handoff_secret: 'synthetic-private', expires_at: new Date(Date.now() + 60000).toISOString() }), { status: 201 })
    return new Response(JSON.stringify({ token, user: { id: 'employee', org_id: 'org', name: 'Employee' } }))
  })
  vi.stubGlobal('fetch', external)
  async function boot() {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader).await()
    Object.assign(ctx.loader.builtins, {
      include: Include, credentials: Credentials, authorization: Authorization, native: NativeAuthorization, enterprise: Enterprise,
    })
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    return ctx
  }
  const first = await boot()
  const native = first.nativeAuthorization.getProvider()!
  const attempt = await native.start('org', new AbortController().signal)
  const callback = new URL(attempt.callbackUrl)
  callback.searchParams.set('code', 'synthetic-code')
  callback.searchParams.set('state', 'org')
  expect((await native.complete(attempt.id, callback.href, new AbortController().signal)).status).toBe('signed-in')
  expect(await readFile(credentialPath, 'utf8')).toContain('uwork-enterprise/identity')
  await first.fiber.dispose()
  const calls = external.mock.calls.length
  const second = await boot()
  expect((await second.uworkIdentity.getState()).status).toBe('authenticated')
  expect(external.mock.calls.slice(calls).map(([input]) => new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).pathname)).toEqual(['/api/auth/refresh'])
  const peer = await boot()
  const staleReader = await boot()
  await staleReader.uworkIdentity.getState()
  await expect(second.uworkIdentity.withSession(async () => {
    await peer.uworkIdentity.signOut()
    return 'late result from a revoked capability'
  })).rejects.toMatchObject({ reason: 'STALE' })
  const forbidden = vi.fn(async () => 'must not execute')
  await expect(staleReader.uworkIdentity.withSession(forbidden)).rejects.toMatchObject({ reason: 'UNAUTHORIZED' })
  expect(forbidden).not.toHaveBeenCalled()
  await expect(second.uworkIdentity.withSession(async () => 'stale capability')).rejects.toMatchObject({ reason: 'UNAUTHORIZED' })
  await second.uworkIdentity.signOut()
  await second.fiber.dispose()
  const third = await boot()
  expect(await third.uworkIdentity.getState()).toEqual({ status: 'signed-out' })
  expect((await readFile(credentialPath, 'utf8')).includes(token)).toBe(false)
})
